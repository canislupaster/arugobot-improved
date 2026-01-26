import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";
import { resolveBoundedIntegerOption } from "../utils/interaction.js";
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

function addLastCompletedField(embed: EmbedBuilder, lastCompletedAt?: string | null): void {
  if (!lastCompletedAt) {
    return;
  }
  const timestampSeconds = Math.floor(Date.parse(lastCompletedAt) / 1000);
  if (!Number.isFinite(timestampSeconds)) {
    return;
  }
  embed.addFields({
    name: "Last completed",
    value: formatDiscordRelativeTime(timestampSeconds),
    inline: false,
  });
}

function buildUserEmbed(
  userId: string,
  sinceLabel: string,
  summary: {
    participations: number;
    solvedCount: number;
    lastCompletedAt?: string | null;
  }
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("User activity")
    .setColor(EMBED_COLORS.info)
    .setDescription(`Last ${sinceLabel} for <@${userId}>`)
    .addFields(
      { name: "Participations", value: String(summary.participations), inline: true },
      { name: "Solved", value: String(summary.solvedCount), inline: true },
      {
        name: "Solve rate",
        value: formatSolveRate(summary.solvedCount, summary.participations),
        inline: true,
      }
    );

  addLastCompletedField(embed, summary.lastCompletedAt);
  return embed;
}

function buildServerEmbed(
  sinceLabel: string,
  summary: {
    completedChallenges: number;
    participantCount: number;
    uniqueParticipants: number;
    solvedCount: number;
  }
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Server activity")
    .setColor(EMBED_COLORS.info)
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
}

function formatTopSolvers(entries: Array<{ userId: string; solvedCount: number }>): string {
  return entries
    .map((entry, index) => `${index + 1}. <@${entry.userId}> - ${entry.solvedCount}`)
    .join("\n");
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
      });
      return;
    }
    const daysResult = resolveBoundedIntegerOption(interaction, {
      name: "days",
      min: MIN_DAYS,
      max: MAX_DAYS,
      defaultValue: DEFAULT_DAYS,
      errorMessage: "Invalid lookback window.",
    });
    if ("error" in daysResult) {
      await interaction.reply({ content: daysResult.error });
      return;
    }
    const { value: days } = daysResult;
    const user = interaction.options.getUser("user");

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

        const embed = buildUserEmbed(user.id, sinceLabel, summary);
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

      const embed = buildServerEmbed(sinceLabel, summary);

      if (summary.topSolvers.length > 0) {
        const filtered = await filterEntriesByGuildMembers(interaction.guild, summary.topSolvers, {
          correlationId: context.correlationId,
          command: interaction.commandName,
          guildId: interaction.guild.id,
          userId: interaction.user.id,
        });
        if (filtered.length > 0) {
          embed.addFields({
            name: "Top solvers",
            value: formatTopSolvers(filtered),
            inline: false,
          });
        }
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in activity: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
