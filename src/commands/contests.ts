import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Contest, ContestScopeFilter } from "../services/contests.js";
import { filterContestsByKeywords, parseKeywordFilters } from "../utils/contestFilters.js";
import { parseContestScope, refreshContestData } from "../utils/contestScope.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatDuration,
} from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_CONTESTS = 5;
function formatContestTag(contest: Contest, scope: ContestScopeFilter): string {
  if (scope === "official") {
    return "";
  }
  return contest.isGym ? " [Gym]" : " [Official]";
}

function buildContestLine(contest: Contest, timing: string, scope: ContestScopeFilter) {
  const label = formatContestTag(contest, scope);
  return `- [${contest.name}](${buildContestUrl(contest)})${label} ${timing}`;
}

function formatScopeLabel(scope: ContestScopeFilter) {
  if (scope === "gym") {
    return " (Gym)";
  }
  if (scope === "all") {
    return " (Official + Gym)";
  }
  return "";
}

function buildFilterSummary(filters: ReturnType<typeof parseKeywordFilters>) {
  const parts: string[] = [];
  if (filters.includeKeywords.length > 0) {
    parts.push(`include: ${filters.includeKeywords.join(", ")}`);
  }
  if (filters.excludeKeywords.length > 0) {
    parts.push(`exclude: ${filters.excludeKeywords.join(", ")}`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `Filters: ${parts.join(" • ")}`;
}

function buildFooterText(stale: boolean, filters: ReturnType<typeof parseKeywordFilters>) {
  const parts: string[] = [];
  if (stale) {
    parts.push("Showing cached data due to a temporary Codeforces error.");
  }
  const filterSummary = buildFilterSummary(filters);
  if (filterSummary) {
    parts.push(filterSummary);
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" ");
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
      option.setName("exclude").setDescription("Hide contests matching keywords (comma-separated)")
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Which contests to show")
        .addChoices(
          { name: "Official", value: "official" },
          { name: "Gym", value: "gym" },
          { name: "All", value: "all" }
        )
    ),
  async execute(interaction, context) {
    const limit = interaction.options.getInteger("limit") ?? MAX_CONTESTS;
    const filters = parseKeywordFilters(
      interaction.options.getString("include"),
      interaction.options.getString("exclude")
    );
    const scope = parseContestScope(interaction.options.getString("scope"));
    await interaction.deferReply();

    const refreshResult = await refreshContestData(context.services.contests, scope);
    if ("error" in refreshResult) {
      await interaction.editReply(refreshResult.error);
      return;
    }
    const stale = refreshResult.stale;

    const ongoing = filterContestsByKeywords(context.services.contests.getOngoing(scope), filters);
    const upcoming = filterContestsByKeywords(
      context.services.contests.getUpcoming(limit, scope),
      filters
    );

    if (ongoing.length === 0 && upcoming.length === 0) {
      await interaction.editReply("No Codeforces contests found.");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Codeforces Contests${formatScopeLabel(scope)}`)
      .setColor(EMBED_COLORS.info);

    if (ongoing.length > 0) {
      const ongoingLines = ongoing
        .map((contest) => {
          const endsAt = contest.startTimeSeconds + contest.durationSeconds;
          return buildContestLine(contest, `(ends ${formatDiscordRelativeTime(endsAt)})`, scope);
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
            )} • ${formatDiscordTimestamp(contest.startTimeSeconds)})`,
            scope
          )
        )
        .join("\n");
      embed.addFields({ name: "Upcoming", value: upcomingLines, inline: false });
    }

    const footerText = buildFooterText(stale, filters);
    if (footerText) {
      embed.setFooter({ text: footerText });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
