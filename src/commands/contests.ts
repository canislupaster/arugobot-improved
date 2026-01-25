import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Contest, ContestScopeFilter } from "../services/contests.js";
import { filterContestsByKeywords, parseKeywordFilters } from "../utils/contestFilters.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatDuration,
} from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_CONTESTS = 5;
const DEFAULT_SCOPE: ContestScopeFilter = "official";

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

function parseScope(raw: string | null): ContestScopeFilter {
  if (raw === "gym" || raw === "all" || raw === "official") {
    return raw;
  }
  return DEFAULT_SCOPE;
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
    const scope = parseScope(interaction.options.getString("scope"));
    await interaction.deferReply();

    let stale = false;
    if (scope === "all") {
      const results = await Promise.allSettled([
        context.services.contests.refresh(false, "official"),
        context.services.contests.refresh(false, "gym"),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        stale = true;
      }
      const lastRefresh = context.services.contests.getLastRefreshAt("all");
      if (lastRefresh <= 0) {
        await interaction.editReply(
          "Unable to reach Codeforces right now. Try again in a few minutes."
        );
        return;
      }
    } else {
      try {
        await context.services.contests.refresh(false, scope);
      } catch {
        if (context.services.contests.getLastRefreshAt(scope) > 0) {
          stale = true;
        } else {
          await interaction.editReply(
            "Unable to reach Codeforces right now. Try again in a few minutes."
          );
          return;
        }
      }
    }

    const ongoing = filterContestsByKeywords(context.services.contests.getOngoing(scope), filters);
    const upcoming = filterContestsByKeywords(
      context.services.contests.getUpcoming(limit, scope),
      filters
    );

    if (ongoing.length === 0 && upcoming.length === 0) {
      await interaction.editReply("No Codeforces contests found.");
      return;
    }

    const scopeLabel = scope === "all" ? " (Official + Gym)" : scope === "gym" ? " (Gym)" : "";
    const embed = new EmbedBuilder()
      .setTitle(`Codeforces Contests${scopeLabel}`)
      .setColor(0x3498db);

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
