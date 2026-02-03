import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import type { Problem } from "../services/problems.js";
import type { CommandContext } from "../types/commandContext.js";
import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { buildProblemUrl, parseProblemReference } from "../utils/problemReference.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function formatWhen(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return "Unknown time";
  }
  return formatDiscordRelativeTime(Math.floor(timestamp / 1000));
}

function buildProblemLink(problem: Problem): string {
  return `[${problem.index}. ${problem.name}](${buildProblemUrl(
    problem.contestId,
    problem.index
  )})`;
}

function buildProblemLinkFromId(problemId: string): string {
  const reference = parseProblemReference(problemId);
  if (!reference) {
    return problemId;
  }
  return `[${reference.id}](${buildProblemUrl(reference.contestId, reference.index)})`;
}

function formatProblemLine(
  problemId: string,
  suggestedAt: string,
  problemDict: Map<string, Problem>
): string {
  const problem = problemDict.get(problemId);
  const link = problem ? buildProblemLink(problem) : buildProblemLinkFromId(problemId);
  return `- ${link} • ${formatWhen(suggestedAt)}`;
}

async function loadProblemDict(
  context: CommandContext,
  interaction: ChatInputCommandInteraction
): Promise<{ problemDict: Map<string, Problem>; cacheLoaded: boolean }> {
  let cacheLoaded = true;
  let problemDict = new Map<string, Problem>();

  try {
    await context.services.problems.ensureProblemsLoaded();
    problemDict = context.services.problems.getProblemDict();
    if (problemDict.size === 0) {
      cacheLoaded = false;
    }
  } catch (error) {
    cacheLoaded = false;
    logCommandError(
      `Problem cache unavailable for practice history: ${String(error)}`,
      interaction,
      context.correlationId
    );
  }

  return { problemDict, cacheLoaded };
}

export const practiceHistoryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("practicehistory")
    .setDescription("Shows recent practice suggestions or reminders")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("suggestions")
        .setDescription("Show recent practice suggestions for a user")
        .addUserOption((option) => option.setName("user").setDescription("User to inspect"))
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription(`Number of suggestions to show (1-${MAX_LIMIT})`)
            .setMinValue(1)
            .setMaxValue(MAX_LIMIT)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reminders")
        .setDescription("Show recent practice reminders posted in this server")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription(`Number of reminders to show (1-${MAX_LIMIT})`)
            .setMinValue(1)
            .setMaxValue(MAX_LIMIT)
        )
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;

    await interaction.deferReply();

    try {
      const { problemDict, cacheLoaded } = await loadProblemDict(context, interaction);

      if (subcommand === "suggestions") {
        const user = interaction.options.getUser("user") ?? interaction.user;
        const entries = await context.services.store.getPracticeSuggestionHistory(
          interaction.guild.id,
          user.id,
          limit
        );

        if (entries.length === 0) {
          await interaction.editReply("No practice suggestions yet.");
          return;
        }

        const lines = entries
          .map((entry) => formatProblemLine(entry.problemId, entry.suggestedAt, problemDict))
          .join("\n");
        const embed = new EmbedBuilder()
          .setTitle("Practice suggestions")
          .setColor(EMBED_COLORS.success)
          .setDescription(lines)
          .addFields({ name: "User", value: `<@${user.id}>`, inline: true });

        if (!cacheLoaded) {
          embed.setFooter({ text: "Problem cache unavailable; showing ids only." });
        }

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const posts = await context.services.practiceReminders.getRecentPosts(
        interaction.guild.id,
        limit
      );
      if (posts.length === 0) {
        await interaction.editReply("No practice reminders have been posted yet.");
        return;
      }

      const lines = posts
        .map((entry) => formatProblemLine(entry.problemId, entry.sentAt, problemDict))
        .join("\n");
      const embed = new EmbedBuilder()
        .setTitle("Practice reminders")
        .setColor(EMBED_COLORS.info)
        .setDescription(lines);

      if (!cacheLoaded) {
        embed.setFooter({ text: "Problem cache unavailable; showing ids only." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in practice history: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
