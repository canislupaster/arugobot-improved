import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Contest, ContestScopeFilter } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatDuration,
} from "../utils/time.js";

import type { Command } from "./types.js";
import { EMBED_COLORS } from "../utils/embedColors.js";

const MAX_MATCHES = 5;
const DEFAULT_SCOPE: ContestScopeFilter = "official";

function parseContestId(raw: string): number | null {
  const trimmed = raw.trim();
  const urlMatch = trimmed.match(/\bcontests?\/(\d+)/i);
  if (urlMatch) {
    const id = Number(urlMatch[1]);
    return Number.isFinite(id) ? id : null;
  }
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    return Number.isFinite(id) ? id : null;
  }
  return null;
}

function formatPhase(phase: Contest["phase"]): string {
  switch (phase) {
    case "BEFORE":
      return "Upcoming";
    case "CODING":
      return "Ongoing";
    case "FINISHED":
      return "Finished";
    case "PENDING_SYSTEM_TEST":
      return "Pending system test";
    case "SYSTEM_TEST":
      return "System test";
    default:
      return phase;
  }
}

function formatContestTag(contest: Contest, scope: ContestScopeFilter): string {
  if (scope === "official") {
    return "";
  }
  return contest.isGym ? "Gym" : "Official";
}

function parseScope(raw: string | null): ContestScopeFilter {
  if (raw === "gym" || raw === "all" || raw === "official") {
    return raw;
  }
  return DEFAULT_SCOPE;
}

function buildContestEmbed(contest: Contest): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(contest.name)
    .setColor(EMBED_COLORS.info)
    .setDescription(`[Open contest](${buildContestUrl(contest)})`)
    .addFields(
      { name: "Contest ID", value: String(contest.id), inline: true },
      { name: "Status", value: formatPhase(contest.phase), inline: true },
      {
        name: "Starts",
        value: `${formatDiscordTimestamp(contest.startTimeSeconds)} (${formatDiscordRelativeTime(
          contest.startTimeSeconds
        )})`,
        inline: false,
      },
      { name: "Duration", value: formatDuration(contest.durationSeconds), inline: true }
    );

  if (contest.phase === "CODING") {
    const endsAt = contest.startTimeSeconds + contest.durationSeconds;
    embed.addFields({
      name: "Ends",
      value: `${formatDiscordTimestamp(endsAt)} (${formatDiscordRelativeTime(endsAt)})`,
      inline: true,
    });
  }

  return embed;
}

function applyScopeAndStale(
  embed: EmbedBuilder,
  contest: Contest,
  scope: ContestScopeFilter,
  stale: boolean
): EmbedBuilder {
  const scopeLabel = formatContestTag(contest, scope);
  if (scopeLabel) {
    embed.addFields({ name: "Section", value: scopeLabel, inline: true });
  }
  if (stale) {
    embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
  }
  return embed;
}

function applyStaleFooter(embed: EmbedBuilder, stale: boolean): EmbedBuilder {
  if (stale) {
    embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
  }
  return embed;
}

function buildMatchEmbed(
  query: string,
  matches: Contest[],
  scope: ContestScopeFilter
): EmbedBuilder {
  const lines = matches
    .map((contest) => {
      const when = formatDiscordRelativeTime(contest.startTimeSeconds);
      const scopeLabel = formatContestTag(contest, scope);
      const scopeSuffix = scopeLabel ? `, ${scopeLabel}` : "";
      return `- ${contest.name} (ID ${contest.id}, ${when}${scopeSuffix})`;
    })
    .join("\n");

  return new EmbedBuilder()
    .setTitle("Contest matches")
    .setColor(EMBED_COLORS.info)
    .setDescription(`Results for "${query}":\n${lines}`)
    .setFooter({ text: "Use /contest with the contest ID for details." });
}

export const contestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contest")
    .setDescription("Shows details for a Codeforces contest")
    .addStringOption((option) =>
      option.setName("query").setDescription("Contest id, URL, or name").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Which contests to search")
        .addChoices(
          { name: "Official", value: "official" },
          { name: "Gym", value: "gym" },
          { name: "All", value: "all" }
        )
    ),
  async execute(interaction, context) {
    const queryRaw = interaction.options.getString("query", true).trim();
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

    try {
      const contestId = parseContestId(queryRaw);
      if (contestId) {
        const contest = context.services.contests.getContestById(contestId, scope);
        if (!contest) {
          await interaction.editReply("No contest found with that ID.");
          return;
        }

        const embed = applyScopeAndStale(buildContestEmbed(contest), contest, scope, stale);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const matches = context.services.contests.searchContests(queryRaw, MAX_MATCHES, scope);
      if (matches.length === 0) {
        await interaction.editReply("No contests found matching that name.");
        return;
      }

      if (matches.length === 1) {
        const contest = matches[0]!;
        const embed = applyScopeAndStale(buildContestEmbed(contest), contest, scope, stale);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const embed = applyStaleFooter(buildMatchEmbed(queryRaw, matches, scope), stale);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in contest: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
