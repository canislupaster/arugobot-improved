import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { CommandContext } from "../types/commandContext.js";
import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";

import type { Command } from "./types.js";

type StatsSummary = {
  userCount: number;
  totalChallenges: number;
  avgRating: number | null;
  topRating: number | null;
  activeChallenges: number;
  activeTournaments: number;
  contestActivity: {
    lookbackDays: number;
    contestCount: number;
    participantCount: number;
  };
};

function formatRatingValue(value: number | null): string {
  return value === null ? "N/A" : String(value);
}

function buildStatsEmbed(summary: StatsSummary): EmbedBuilder {
  const contestWindowLabel = `${summary.contestActivity.lookbackDays}d`;
  return new EmbedBuilder()
    .setTitle("Server stats")
    .setColor(EMBED_COLORS.info)
    .addFields(
      { name: "Linked users", value: String(summary.userCount), inline: true },
      { name: "Total challenges", value: String(summary.totalChallenges), inline: true },
      { name: "Active challenges", value: String(summary.activeChallenges), inline: true },
      { name: "Active tournaments", value: String(summary.activeTournaments), inline: true },
      {
        name: `Contests (${contestWindowLabel})`,
        value: String(summary.contestActivity.contestCount),
        inline: true,
      },
      {
        name: `Contest participants (${contestWindowLabel})`,
        value: String(summary.contestActivity.participantCount),
        inline: true,
      },
      { name: "Average rating", value: formatRatingValue(summary.avgRating), inline: true },
      { name: "Top rating", value: formatRatingValue(summary.topRating), inline: true }
    );
}

async function fetchStatsSummary(
  guildId: string,
  context: CommandContext
): Promise<StatsSummary> {
  const [stats, activeChallenges, activeTournaments, contestActivity] = await Promise.all([
    context.services.store.getServerStats(guildId),
    context.services.challenges.getActiveCountForServer(guildId),
    context.services.tournaments.getActiveCountForGuild(guildId),
    context.services.contestActivity.getGuildContestActivity(guildId),
  ]);

  return {
    userCount: stats.userCount,
    totalChallenges: stats.totalChallenges,
    avgRating: stats.avgRating,
    topRating: stats.topRating,
    activeChallenges,
    activeTournaments,
    contestActivity: {
      lookbackDays: contestActivity.lookbackDays,
      contestCount: contestActivity.contestCount,
      participantCount: contestActivity.participantCount,
    },
  };
}

export const statsCommand: Command = {
  data: new SlashCommandBuilder().setName("stats").setDescription("Shows server challenge stats"),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    await interaction.deferReply();

    try {
      const summary = await fetchStatsSummary(interaction.guild.id, context);
      if (summary.userCount === 0) {
        await interaction.editReply("No linked users yet.");
        return;
      }

      await interaction.editReply({ embeds: [buildStatsEmbed(summary)] });
    } catch (error) {
      logCommandError(`Error in stats: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
