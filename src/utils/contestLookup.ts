import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";

import type { Contest, ContestScopeFilter } from "../services/contests.js";

import { buildContestUrl } from "./contestUrl.js";
import { EMBED_COLORS } from "./embedColors.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatDuration,
} from "./time.js";

const LATEST_CONTEST_QUERIES = new Set(["latest", "last", "recent"]);

type ContestMatchEmbedOptions = {
  query: string;
  matches: Contest[];
  scope: ContestScopeFilter;
  footerText: string;
};

export type ContestLookupResult =
  | { status: "ok"; contest: Contest }
  | { status: "ambiguous"; matches: Contest[] }
  | { status: "missing_latest" | "missing_id" | "missing_name" };

export type ContestLookupService = {
  getLatestFinished: (scopeFilter: ContestScopeFilter) => Contest | null;
  getContestById: (contestId: number, scopeFilter: ContestScopeFilter) => Contest | null;
  searchContests: (query: string, limit: number, scopeFilter: ContestScopeFilter) => Contest[];
};

export type ContestLookupReplyResult =
  | { status: "ok"; contest: Contest }
  | { status: "replied" };

type ContestEmbedOptions = {
  contest: Contest;
  title: string;
  scope?: ContestScopeFilter;
  includeScope?: boolean;
};

export function parseContestId(raw: string): number | null {
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

export function isLatestQuery(raw: string): boolean {
  return LATEST_CONTEST_QUERIES.has(raw.trim().toLowerCase());
}

export function resolveContestLookup(
  queryRaw: string,
  scope: ContestScopeFilter,
  contests: ContestLookupService,
  maxMatches = 5
): ContestLookupResult {
  const wantsLatest = isLatestQuery(queryRaw);
  const contestId = parseContestId(queryRaw);
  if (wantsLatest) {
    const contest = contests.getLatestFinished(scope);
    if (!contest) {
      return { status: "missing_latest" };
    }
    return { status: "ok", contest };
  }
  if (contestId) {
    const contest = contests.getContestById(contestId, scope);
    if (!contest) {
      return { status: "missing_id" };
    }
    return { status: "ok", contest };
  }
  const matches = contests.searchContests(queryRaw, maxMatches, scope);
  if (matches.length === 0) {
    return { status: "missing_name" };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return { status: "ok", contest: matches[0] };
}

type ContestLookupReplyOptions = {
  maxMatches?: number;
  footerText: string;
  refreshWasStale: boolean;
  missingLatestMessage?: string;
  missingIdMessage?: string;
  missingNameMessage?: string;
};

export async function resolveContestOrReply(
  interaction: ChatInputCommandInteraction,
  queryRaw: string,
  scope: ContestScopeFilter,
  contests: ContestLookupService,
  options: ContestLookupReplyOptions
): Promise<ContestLookupReplyResult> {
  const lookup = resolveContestLookup(queryRaw, scope, contests, options.maxMatches ?? 5);
  if (lookup.status === "ok") {
    return { status: "ok", contest: lookup.contest };
  }
  if (lookup.status === "ambiguous") {
    const embed = buildContestMatchEmbed({
      query: queryRaw,
      matches: lookup.matches,
      scope,
      footerText: options.footerText,
    });
    if (options.refreshWasStale) {
      embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
    }
    await interaction.editReply({ embeds: [embed] });
    return { status: "replied" };
  }

  const missingLatestMessage = options.missingLatestMessage ?? "No finished contests found yet.";
  const missingIdMessage = options.missingIdMessage ?? "No contest found with that ID.";
  const missingNameMessage = options.missingNameMessage ?? "No contests found matching that name.";
  const errorMessage =
    lookup.status === "missing_latest"
      ? missingLatestMessage
      : lookup.status === "missing_id"
        ? missingIdMessage
        : missingNameMessage;
  await interaction.editReply(errorMessage);
  return { status: "replied" };
}

export function formatContestPhase(phase: Contest["phase"]): string {
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

export function formatContestTag(contest: Contest, scope: ContestScopeFilter): string {
  if (scope === "official") {
    return "";
  }
  return contest.isGym ? "Gym" : "Official";
}

export function buildContestMatchEmbed({
  query,
  matches,
  scope,
  footerText,
}: ContestMatchEmbedOptions): EmbedBuilder {
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
    .setFooter({ text: footerText });
}

export function buildContestEmbed({
  contest,
  title,
  scope,
  includeScope = false,
}: ContestEmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(EMBED_COLORS.info)
    .setDescription(`[Open contest](${buildContestUrl(contest)})`)
    .addFields(
      { name: "Contest ID", value: String(contest.id), inline: true },
      { name: "Status", value: formatContestPhase(contest.phase), inline: true },
      {
        name: "Starts",
        value: `${formatDiscordTimestamp(contest.startTimeSeconds)} (${formatDiscordRelativeTime(
          contest.startTimeSeconds
        )})`,
        inline: false,
      },
      { name: "Duration", value: formatDuration(contest.durationSeconds), inline: true }
    );

  if (includeScope && scope) {
    const scopeLabel = formatContestTag(contest, scope);
    if (scopeLabel) {
      embed.addFields({ name: "Section", value: scopeLabel, inline: true });
    }
  }

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
