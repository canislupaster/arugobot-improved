import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_DAYS = 90;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function formatDelta(value: number): string {
  const rounded = Math.round(value);
  return rounded >= 0 ? `+${rounded}` : String(rounded);
}

function formatParticipantLine(entry: {
  userId: string;
  handle: string;
  delta: number;
  contestCount: number;
  lastContestAt: number | null;
}): string {
  const lastContest =
    entry.lastContestAt && entry.lastContestAt > 0
      ? ` • last ${formatDiscordRelativeTime(entry.lastContestAt)}`
      : "";
  return `<@${entry.userId}> (${entry.handle}) • ${formatDelta(entry.delta)} • ${
    entry.contestCount
  } contests${lastContest}`;
}

function formatParticipantSection(
  entries: Array<{
    userId: string;
    handle: string;
    delta: number;
    contestCount: number;
    lastContestAt: number | null;
  }>,
  emptyLabel: string
): string {
  if (entries.length === 0) {
    return emptyLabel;
  }
  return entries.map((entry, index) => `${index + 1}. ${formatParticipantLine(entry)}`).join("\n");
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
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    const days = interaction.options.getInteger("days") ?? DEFAULT_DAYS;
    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      await interaction.reply({ content: "Invalid lookback window." });
      return;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      await interaction.reply({ content: "Invalid limit." });
      return;
    }

    await interaction.deferReply();

    try {
      const roster = await context.services.store.getServerRoster(interaction.guild.id);
      const filteredRoster = await filterEntriesByGuildMembers(interaction.guild, roster, {
        correlationId: context.correlationId,
        command: interaction.commandName,
        guildId: interaction.guild.id,
        userId: interaction.user.id,
      });
      const summary = await context.services.contestActivity.getRatingChangeSummaryForRoster(
        filteredRoster,
        { lookbackDays: days, limit }
      );

      if (summary.contestCount === 0) {
        await interaction.editReply(
          `No rating changes for linked handles in the last ${days} days.`
        );
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Contest rating deltas")
        .setColor(EMBED_COLORS.info)
        .setDescription(`Last ${days} days`)
        .addFields(
          { name: "Contests", value: String(summary.contestCount), inline: true },
          { name: "Participants", value: String(summary.participantCount), inline: true },
          { name: "Total delta", value: formatDelta(summary.totalDelta), inline: true }
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
