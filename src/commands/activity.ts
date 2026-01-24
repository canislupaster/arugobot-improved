import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { ephemeralFlags } from "../utils/discordFlags.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const MIN_DAYS = 1;
const TOP_SOLVERS_LIMIT = 5;

function buildSinceIso(days: number): string {
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  return new Date(now - windowMs).toISOString();
}

function formatSolveRate(solved: number, total: number): string {
  if (total <= 0) {
    return "N/A";
  }
  const rate = Math.round((solved / total) * 100);
  return `${rate}% (${solved}/${total})`;
}

export const activityCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("activity")
    .setDescription("Shows challenge activity for this server or a user")
    .addIntegerOption((option) =>
      option
        .setName("days")
        .setDescription(`Lookback window (${MIN_DAYS}-${MAX_DAYS} days)`)
        .setMinValue(MIN_DAYS)
        .setMaxValue(MAX_DAYS)
    )
    .addUserOption((option) => option.setName("user").setDescription("User to inspect")),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ...ephemeralFlags,
      });
      return;
    }

    const days = interaction.options.getInteger("days") ?? DEFAULT_DAYS;
    const user = interaction.options.getUser("user");
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      await interaction.reply({ content: "Invalid lookback window.", ...ephemeralFlags });
      return;
    }

    await interaction.deferReply();

    const sinceIso = buildSinceIso(days);
    const sinceLabel = `${days} days`;

    try {
      if (user) {
        const summary = await context.services.store.getUserChallengeActivity(
          interaction.guild.id,
          user.id,
          sinceIso
        );
        if (summary.participations === 0) {
          await interaction.editReply(`No challenges for <@${user.id}> in the last ${sinceLabel}.`);
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle("User activity")
          .setColor(0x3498db)
          .setDescription(`Last ${sinceLabel} for <@${user.id}>`)
          .addFields(
            { name: "Participations", value: String(summary.participations), inline: true },
            { name: "Solved", value: String(summary.solvedCount), inline: true },
            {
              name: "Solve rate",
              value: formatSolveRate(summary.solvedCount, summary.participations),
              inline: true,
            }
          );

        if (summary.lastCompletedAt) {
          const timestampSeconds = Math.floor(Date.parse(summary.lastCompletedAt) / 1000);
          if (Number.isFinite(timestampSeconds)) {
            embed.addFields({
              name: "Last completed",
              value: formatDiscordRelativeTime(timestampSeconds),
              inline: false,
            });
          }
        }

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const summary = await context.services.store.getChallengeActivity(
        interaction.guild.id,
        sinceIso,
        TOP_SOLVERS_LIMIT
      );
      if (summary.completedChallenges === 0) {
        await interaction.editReply(`No completed challenges in the last ${sinceLabel}.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Server activity")
        .setColor(0x3498db)
        .setDescription(`Last ${sinceLabel}`)
        .addFields(
          {
            name: "Completed challenges",
            value: String(summary.completedChallenges),
            inline: true,
          },
          { name: "Participants", value: String(summary.participantCount), inline: true },
          { name: "Unique users", value: String(summary.uniqueParticipants), inline: true },
          {
            name: "Solve rate",
            value: formatSolveRate(summary.solvedCount, summary.participantCount),
            inline: true,
          }
        );

      if (summary.topSolvers.length > 0) {
        const lines = summary.topSolvers
          .map((entry, index) => `${index + 1}. <@${entry.userId}> - ${entry.solvedCount}`)
          .join("\n");
        embed.addFields({ name: "Top solvers", value: lines, inline: false });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in activity: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
