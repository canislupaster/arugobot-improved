import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { ephemeralFlags } from "../utils/discordFlags.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_DAYS = 90;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function formatContestLine(contest: {
  contestId: number;
  contestName: string;
  ratingUpdateTimeSeconds: number;
}): string {
  return `${contest.contestName} (${contest.contestId}) • ${formatDiscordRelativeTime(
    contest.ratingUpdateTimeSeconds
  )}`;
}

export const contestActivityCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestactivity")
    .setDescription("Shows recent contest participation for this server")
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
        .setDescription(`Top participants to show (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ...ephemeralFlags,
      });
      return;
    }

    const days = interaction.options.getInteger("days") ?? DEFAULT_DAYS;
    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      await interaction.reply({ content: "Invalid lookback window.", ...ephemeralFlags });
      return;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      await interaction.reply({ content: "Invalid participant limit.", ...ephemeralFlags });
      return;
    }

    await interaction.deferReply();

    try {
      const activity = await context.services.contestActivity.getGuildContestActivity(
        interaction.guild.id,
        { lookbackDays: days, participantLimit: limit }
      );
      if (activity.contestCount === 0) {
        await interaction.editReply(
          `No contest activity for linked handles in the last ${days} days.`
        );
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Contest activity")
        .setColor(0x3498db)
        .setDescription(`Last ${days} days`)
        .addFields(
          { name: "Contests", value: String(activity.contestCount), inline: true },
          { name: "Participants", value: String(activity.participantCount), inline: true }
        );

      if (activity.participants.length > 0) {
        const lines = activity.participants
          .map(
            (entry, index) =>
              `${index + 1}. <@${entry.userId}> (${entry.handle}) - ${entry.contestCount}`
          )
          .join("\n");
        embed.addFields({ name: "Top participants", value: lines, inline: false });
      }

      if (activity.recentContests.length > 0) {
        const lines = activity.recentContests.map(formatContestLine).join("\n");
        embed.addFields({ name: "Recent contests", value: lines, inline: false });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contest activity: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
