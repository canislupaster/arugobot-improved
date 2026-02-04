import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { buildProblemUrl } from "../utils/problemReference.js";
import { formatTime } from "../utils/rating.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_LIMIT = 5;
const DEFAULT_RECENT_LIMIT = 5;
const MAX_LIMIT = 10;
const SELECT_TIMEOUT_MS = 30_000;

type ChallengeProblem = {
  contestId: number;
  index: string;
  name: string;
};

type ActiveChallengeSummary = {
  channelId: string;
  hostUserId: string;
  endsAt: number;
  problem: ChallengeProblem;
};

type RecentChallengeSummary = ActiveChallengeSummary & {
  startedAt: number;
  completedAt?: number | null;
  participants: Array<{ userId: string; solvedAt: number | null }>;
};

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildProblemLink(contestId: number, index: string, name: string): string {
  return `[${index}. ${name}](${buildProblemUrl(contestId, index)})`;
}

function formatActiveChallengeLine(
  challenge: ActiveChallengeSummary,
  nowSeconds: number
): string {
  const timeLeft = Math.max(0, challenge.endsAt - nowSeconds);
  const link = buildProblemLink(
    challenge.problem.contestId,
    challenge.problem.index,
    challenge.problem.name
  );
  return `- <#${challenge.channelId}> • ${link} • host <@${challenge.hostUserId}> • ${formatTime(
    timeLeft
  )} left`;
}

function buildActiveChallengesEmbed(
  title: string,
  challenges: ActiveChallengeSummary[],
  options: { nowSeconds: number; limit?: number }
): EmbedBuilder {
  const limit = options.limit ?? challenges.length;
  const lines = challenges
    .slice(0, limit)
    .map((challenge) => formatActiveChallengeLine(challenge, options.nowSeconds));
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(EMBED_COLORS.info)
    .setDescription(lines.join("\n"));
  if (options.limit && challenges.length > limit) {
    embed.setFooter({ text: `Showing ${limit} of ${challenges.length} active challenges.` });
  }
  return embed;
}

async function replyWithActiveChallenges(
  interaction: Parameters<Command["execute"]>[0],
  title: string,
  challenges: ActiveChallengeSummary[],
  options: { limit?: number; emptyMessage: string }
): Promise<boolean> {
  if (challenges.length === 0) {
    await interaction.reply({ content: options.emptyMessage });
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const embed = buildActiveChallengesEmbed(title, challenges, {
    nowSeconds,
    limit: options.limit,
  });
  await interaction.reply({ embeds: [embed] });
  return true;
}

function getFirstSolveSummary(challenge: RecentChallengeSummary): string {
  const solved = challenge.participants.filter((participant) => participant.solvedAt !== null);
  if (solved.length === 0) {
    return "No solves";
  }

  let firstSolvedAt = Number.POSITIVE_INFINITY;
  let firstSolverId: string | null = null;
  for (const participant of solved) {
    if (participant.solvedAt !== null && participant.solvedAt < firstSolvedAt) {
      firstSolvedAt = participant.solvedAt;
      firstSolverId = participant.userId;
    }
  }

  if (!firstSolverId || !Number.isFinite(firstSolvedAt)) {
    return "No solves";
  }

  const duration = formatTime(Math.max(0, firstSolvedAt - challenge.startedAt));
  return `<@${firstSolverId}> in ${duration}`;
}

function buildRecentChallengeField(
  challenge: RecentChallengeSummary
): { name: string; value: string; inline: boolean } {
  const solved = challenge.participants.filter((participant) => participant.solvedAt !== null);
  const total = challenge.participants.length;
  const firstSolve = getFirstSolveSummary(challenge);
  const completedAt = challenge.completedAt ?? challenge.endsAt;
  const problemLabel = truncateLabel(
    `${challenge.problem.index}. ${challenge.problem.name}`,
    80
  );
  const link = buildProblemLink(
    challenge.problem.contestId,
    challenge.problem.index,
    truncateLabel(challenge.problem.name, 80)
  );
  return {
    name: problemLabel,
    value: [
      `Problem: ${link}`,
      `Channel: <#${challenge.channelId}>`,
      `Host: <@${challenge.hostUserId}>`,
      `Solved: ${solved.length}/${total}`,
      `Completed: ${formatDiscordRelativeTime(completedAt)}`,
      `First solve: ${firstSolve}`,
    ].join("\n"),
    inline: false,
  };
}

export const challengesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("challenges")
    .setDescription("List or cancel active challenges")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("Show active challenges in this server")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription(`Number of challenges to show (1-${MAX_LIMIT})`)
            .setMinValue(1)
            .setMaxValue(MAX_LIMIT)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("mine").setDescription("Show your active challenge (if any)")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("recent")
        .setDescription("Show recently completed challenges in this server")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription(`Number of challenges to show (1-${MAX_LIMIT})`)
            .setMinValue(1)
            .setMaxValue(MAX_LIMIT)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("cancel").setDescription("Cancel an active challenge (host or admin only)")
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "list") {
        const challenges = await context.services.challenges.listActiveChallenges(guildId);
        const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
        await replyWithActiveChallenges(interaction, "Active challenges", challenges, {
          limit,
          emptyMessage: "No active challenges right now.",
        });
        return;
      }

      if (subcommand === "mine") {
        const challenges = await context.services.challenges.listActiveChallengesForUser(
          guildId,
          interaction.user.id
        );
        await replyWithActiveChallenges(interaction, "Your active challenges", challenges, {
          emptyMessage: "You have no active challenges right now.",
        });
        return;
      }

      if (subcommand === "recent") {
        const limit = interaction.options.getInteger("limit") ?? DEFAULT_RECENT_LIMIT;
        const challenges = await context.services.challenges.listRecentCompletedChallenges(
          guildId,
          limit
        );
        if (challenges.length === 0) {
          await interaction.reply({
            content: "No completed challenges yet.",
          });
          return;
        }

        const embed = new EmbedBuilder().setTitle("Recent challenges").setColor(EMBED_COLORS.info);

        embed.addFields(challenges.map((challenge) => buildRecentChallengeField(challenge)));

        await interaction.reply({ embeds: [embed] });
        return;
      }

      const challenges = await context.services.challenges.listActiveChallenges(guildId);
      if (challenges.length === 0) {
        await interaction.reply({ content: "No active challenges to cancel." });
        return;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const options = challenges.slice(0, 25).map((challenge) => {
        const label = truncateLabel(`${challenge.problem.index}. ${challenge.problem.name}`, 90);
        const timeLeft = Math.max(0, challenge.endsAt - nowSeconds);
        const description = `<#${challenge.channelId}> • ${formatTime(timeLeft)} left`;
        return new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setDescription(description)
          .setValue(challenge.id);
      });

      const selectId = `challenge_cancel_${interaction.id}`;
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(selectId)
          .setPlaceholder("Select a challenge to cancel")
          .addOptions(options)
      );

      const embed = new EmbedBuilder()
        .setTitle("Cancel a challenge")
        .setColor(EMBED_COLORS.warning)
        .setDescription("Select the active challenge you want to cancel.");

      const response = await interaction.reply({
        embeds: [embed],
        components: [row],
        fetchReply: true,
      });

      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: SELECT_TIMEOUT_MS,
      });

      collector.on("collect", async (selection) => {
        if (selection.customId !== selectId) {
          return;
        }
        const selectedId = selection.values[0];
        const selected = challenges.find((challenge) => challenge.id === selectedId);
        if (!selected) {
          await selection.reply({
            content: "That challenge is no longer active.",
          });
          return;
        }

        const isAdmin = selection.memberPermissions?.has(PermissionFlagsBits.Administrator);
        const isHost = selection.user.id === selected.hostUserId;
        if (!isAdmin && !isHost) {
          await selection.reply({
            content: "Only the host or an admin can cancel this challenge.",
          });
          return;
        }

        const cancelled = await context.services.challenges.cancelChallenge(
          selected.id,
          selection.user.id,
          context.client
        );
        if (!cancelled) {
          await selection.update({
            content: "Challenge already ended or could not be cancelled.",
            embeds: [],
            components: [],
          });
          collector.stop("handled");
          return;
        }

        await selection.update({
          content: "Challenge cancelled.",
          embeds: [],
          components: [],
        });
        collector.stop("handled");
      });

      collector.on("end", async (_collected, reason) => {
        if (reason === "handled") {
          return;
        }
        await interaction.editReply({
          content: "No selection received. No challenges were cancelled.",
          embeds: [],
          components: [],
        });
      });
    } catch (error) {
      logCommandError(`Error in challenges: ${String(error)}`, interaction, context.correlationId);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Something went wrong." });
      } else {
        await interaction.reply({ content: "Something went wrong." });
      }
    }
  },
};
