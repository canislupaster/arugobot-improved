import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type {
  GuildRatingChangeSummary,
  RatingChangeParticipantSummary,
} from "../services/contestActivity.js";
import type { ContestScopeFilter } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import { resolveContestActivityOptions } from "../utils/contestActivityOptions.js";
import { addContestScopeOption } from "../utils/contestScope.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";
import { formatRatingDelta } from "../utils/ratingChanges.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_DAYS = 90;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const DEFAULT_SCOPE: ContestScopeFilter = "all";

function formatParticipantLine(entry: RatingChangeParticipantSummary): string {
  const lastContest =
    entry.lastContestAt && entry.lastContestAt > 0
      ? ` • last ${formatDiscordRelativeTime(entry.lastContestAt)}`
      : "";
  return `<@${entry.userId}> (${entry.handle}) • ${formatRatingDelta(entry.delta, {
    round: true,
  })} • ${
    entry.contestCount
  } contests${lastContest}`;
}

function formatParticipantSection(
  entries: RatingChangeParticipantSummary[],
  emptyLabel: string
): string {
  if (entries.length === 0) {
    return emptyLabel;
  }
  return entries.map((entry, index) => `${index + 1}. ${formatParticipantLine(entry)}`).join("\n");
}

function buildSummaryEmbed(
  summary: GuildRatingChangeSummary,
  days: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Contest rating deltas")
    .setColor(EMBED_COLORS.info)
    .setDescription(`Last ${days} days`)
    .addFields(
      { name: "Contests", value: String(summary.contestCount), inline: true },
      { name: "Participants", value: String(summary.participantCount), inline: true },
      {
        name: "Total delta",
        value: formatRatingDelta(summary.totalDelta, { round: true }),
        inline: true,
      }
    );

  if (summary.lastContestAt) {
    embed.addFields({
      name: "Last contest",
      value: formatDiscordRelativeTime(summary.lastContestAt),
      inline: true,
    });
  }

  embed.addFields(
    {
      name: "Top gainers",
      value: formatParticipantSection(summary.topGainers, "No gainers yet."),
      inline: false,
    },
    {
      name: "Top losers",
      value: formatParticipantSection(summary.topLosers, "No losers yet."),
      inline: false,
    }
  );

  return embed;
}

export const contestDeltasCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestdeltas")
    .setDescription("Shows recent contest rating changes for this server")
    .addIntegerOption((option) =>
      option
        .setName("days")
        .setDescription(`Lookback window (${MIN_DAYS}-${MAX_DAYS} days)`)
        .setMinValue(MIN_DAYS)
        .setMaxValue(MAX_DAYS)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Top gainers/losers to show (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    )
    .addStringOption((option) =>
      addContestScopeOption(option, "Which contests to include", ["all", "official", "gym"])
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    const optionResult = resolveContestActivityOptions(interaction, {
      defaultDays: DEFAULT_DAYS,
      minDays: MIN_DAYS,
      maxDays: MAX_DAYS,
      defaultLimit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
      defaultScope: DEFAULT_SCOPE,
      daysErrorMessage: "Invalid lookback window.",
      limitErrorMessage: "Invalid limit.",
    });
    if (optionResult.status === "error") {
      await interaction.reply({ content: optionResult.message });
      return;
    }
    const { days, limit, scope } = optionResult;

    await interaction.deferReply();

    try {
      const roster = await context.services.store.getServerRoster(interaction.guild.id);
      if (roster.length === 0) {
        await interaction.editReply(
          "No linked handles yet. Use /register to link a Codeforces handle."
        );
        return;
      }
      const filteredRoster = await filterEntriesByGuildMembers(interaction.guild, roster, {
        correlationId: context.correlationId,
        command: interaction.commandName,
        guildId: interaction.guild.id,
        userId: interaction.user.id,
      });
      if (filteredRoster.length === 0) {
        await interaction.editReply(
          "No linked handles found for current server members."
        );
        return;
      }
      const summary = await context.services.contestActivity.getRatingChangeSummaryForRoster(
        filteredRoster,
        { lookbackDays: days, limit, scope }
      );

      if (summary.contestCount === 0) {
        await interaction.editReply(
          `No rating changes for linked handles in the last ${days} days.`
        );
        return;
      }

      const embed = buildSummaryEmbed(summary, days);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contest deltas: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
