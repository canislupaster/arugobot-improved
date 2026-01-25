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
