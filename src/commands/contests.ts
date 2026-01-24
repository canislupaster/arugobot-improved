import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { filterContestsByKeywords, parseKeywordFilters } from "../utils/contestFilters.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatDuration,
} from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_CONTESTS = 5;

function buildContestLine(contest: { id: number; name: string }, timing: string) {
  return `- [${contest.name}](https://codeforces.com/contest/${contest.id}) ${timing}`;
}

export const contestsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contests")
    .setDescription("Shows upcoming and ongoing Codeforces contests")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of upcoming contests to show (1-${MAX_CONTESTS})`)
        .setMinValue(1)
        .setMaxValue(MAX_CONTESTS)
    )
    .addStringOption((option) =>
      option
        .setName("include")
        .setDescription("Only show contests matching keywords (comma-separated)")
    )
    .addStringOption((option) =>
      option
        .setName("exclude")
        .setDescription("Hide contests matching keywords (comma-separated)")
    ),
  async execute(interaction, context) {
    const limit = interaction.options.getInteger("limit") ?? MAX_CONTESTS;
    const filters = parseKeywordFilters(
      interaction.options.getString("include"),
      interaction.options.getString("exclude")
    );
    await interaction.deferReply();

    let stale = false;
    try {
      await context.services.contests.refresh();
    } catch {
      if (context.services.contests.getLastRefreshAt() > 0) {
        stale = true;
      } else {
        await interaction.editReply(
          "Unable to reach Codeforces right now. Try again in a few minutes."
        );
        return;
      }
    }

    const ongoing = filterContestsByKeywords(context.services.contests.getOngoing(), filters);
    const upcoming = filterContestsByKeywords(
      context.services.contests.getUpcoming(limit),
      filters
    );

    if (ongoing.length === 0 && upcoming.length === 0) {
      await interaction.editReply("No Codeforces contests found.");
      return;
    }

    const embed = new EmbedBuilder().setTitle("Codeforces Contests").setColor(0x3498db);

    if (ongoing.length > 0) {
      const ongoingLines = ongoing
        .map((contest) => {
          const endsAt = contest.startTimeSeconds + contest.durationSeconds;
          return buildContestLine(contest, `(ends ${formatDiscordRelativeTime(endsAt)})`);
        })
        .join("\n");
      embed.addFields({ name: "Ongoing", value: ongoingLines, inline: false });
    }

    if (upcoming.length > 0) {
      const upcomingLines = upcoming
        .map((contest) =>
          buildContestLine(
            contest,
            `(starts ${formatDiscordRelativeTime(contest.startTimeSeconds)} • ${formatDuration(
              contest.durationSeconds
            )} • ${formatDiscordTimestamp(contest.startTimeSeconds)})`
          )
        )
        .join("\n");
      embed.addFields({ name: "Upcoming", value: upcomingLines, inline: false });
    }

    const filterParts: string[] = [];
    if (filters.includeKeywords.length > 0) {
      filterParts.push(`include: ${filters.includeKeywords.join(", ")}`);
    }
    if (filters.excludeKeywords.length > 0) {
      filterParts.push(`exclude: ${filters.excludeKeywords.join(", ")}`);
    }
    const footerParts = [];
    if (stale) {
      footerParts.push("Showing cached data due to a temporary Codeforces error.");
    }
    if (filterParts.length > 0) {
      footerParts.push(`Filters: ${filterParts.join(" • ")}`);
    }
    if (footerParts.length > 0) {
      embed.setFooter({ text: footerParts.join(" ") });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
