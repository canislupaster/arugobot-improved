import { EmbedBuilder, SlashCommandBuilder, type Guild, type User } from "discord.js";

import type { Contest, ContestScope, ContestScopeFilter } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatDuration,
} from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_MATCHES = 5;
const MAX_HANDLES = 50;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const DEFAULT_SCOPE: ContestScopeFilter = "official";

type TargetHandle = {
  handle: string;
  label: string;
};

type ContestLookup =
  | { status: "ok"; contest: Contest }
  | { status: "ambiguous"; matches: Contest[] }
  | { status: "missing_latest" | "missing_id" | "missing_name" };

function parseHandleList(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

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

const LATEST_CONTEST_QUERIES = new Set(["latest", "last", "recent"]);

function isLatestQuery(raw: string): boolean {
  return LATEST_CONTEST_QUERIES.has(raw.trim().toLowerCase());
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

function formatParticipantType(type: string): string {
  switch (type) {
    case "OUT_OF_COMPETITION":
      return "OOC";
    case "VIRTUAL":
      return "Virtual";
    case "PRACTICE":
      return "Practice";
    default:
      return type;
  }
}

function formatPoints(points: number): string {
  if (!Number.isFinite(points)) {
    return "0";
  }
  if (Number.isInteger(points)) {
    return String(points);
  }
  return points.toFixed(2);
}

function formatContestTag(contest: Contest, scope: ContestScopeFilter): string {
  if (scope === "official") {
    return "";
  }
  return contest.isGym ? "Gym" : "Official";
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
    .setColor(0x3498db)
    .setDescription(`Results for "${query}":\n${lines}`)
    .setFooter({ text: "Use /contestresults with the contest ID for standings." });
}

function buildContestEmbed(contest: Contest): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Contest results: ${contest.name}`)
    .setColor(0x3498db)
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

function parseScope(raw: string | null): ContestScopeFilter {
  if (raw === "gym" || raw === "all" || raw === "official") {
    return raw;
  }
  return DEFAULT_SCOPE;
}

function addTargetHandle(existing: Map<string, TargetHandle>, handle: string, label: string) {
  const key = handle.toLowerCase();
  if (existing.has(key)) {
    return;
  }
  existing.set(key, { handle, label });
}

function getUserOptions(users: Array<User | null | undefined>): User[] {
  return users.filter((user): user is User => Boolean(user));
}

function lookupContest(
  queryRaw: string,
  scope: ContestScopeFilter,
  contests: {
    getLatestFinished: (scopeFilter: ContestScopeFilter) => Contest | null;
    getContestById: (contestId: number, scopeFilter: ContestScopeFilter) => Contest | null;
    searchContests: (query: string, limit: number, scopeFilter: ContestScopeFilter) => Contest[];
  }
): ContestLookup {
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
  const matches = contests.searchContests(queryRaw, MAX_MATCHES, scope);
  if (matches.length === 0) {
    return { status: "missing_name" };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return { status: "ok", contest: matches[0] };
}

async function refreshContestData(
  scope: ContestScopeFilter,
  contests: {
    refresh: (force?: boolean, scopeFilter?: ContestScope) => Promise<void>;
    getLastRefreshAt: (scopeFilter: ContestScopeFilter) => number;
  }
): Promise<{ stale: boolean } | { error: string }> {
  if (scope === "all") {
    const results = await Promise.allSettled([
      contests.refresh(false, "official"),
      contests.refresh(false, "gym"),
    ]);
    const stale = results.some((result) => result.status === "rejected");
    if (contests.getLastRefreshAt("all") <= 0) {
      return { error: "Unable to reach Codeforces right now. Try again in a few minutes." };
    }
    return { stale };
  }

  try {
    await contests.refresh(false, scope);
    return { stale: false };
  } catch {
    if (contests.getLastRefreshAt(scope) > 0) {
      return { stale: true };
    }
    return { error: "Unable to reach Codeforces right now. Try again in a few minutes." };
  }
}

async function buildTargets(
  context: {
    services: {
      store: {
        getHandle: (guildId: string, userId: string) => Promise<string | null>;
        resolveHandle: (handle: string) => Promise<{
          exists: boolean;
          canonicalHandle: string | null;
        }>;
        getLinkedUsers: (guildId: string) => Promise<Array<{ userId: string; handle: string }>>;
      };
    };
    correlationId: string;
  },
  interaction: { guildId: string | null; commandName: string; user: User; guild: Guild | null },
  userOptions: User[],
  handleInputs: string[]
): Promise<{ targets: TargetHandle[] } | { error: string }> {
  const targets = new Map<string, TargetHandle>();

  if (userOptions.length > 0 || handleInputs.length > 0) {
    if (interaction.guildId) {
      for (const user of userOptions) {
        const handle = await context.services.store.getHandle(interaction.guildId, user.id);
        if (!handle) {
          return { error: `User <@${user.id}> does not have a linked handle.` };
        }
        addTargetHandle(targets, handle, `<@${user.id}>`);
      }
    }

    for (const handleInput of handleInputs) {
      const resolved = await context.services.store.resolveHandle(handleInput);
      if (!resolved.exists) {
        return { error: `Invalid handle: ${handleInput}` };
      }
      const handle = resolved.canonicalHandle ?? handleInput;
      addTargetHandle(targets, handle, handle);
    }
  } else {
    const guildId = interaction.guildId ?? "";
    const linkedUsers = await context.services.store.getLinkedUsers(guildId);
    const filteredLinkedUsers = interaction.guild
      ? await filterEntriesByGuildMembers(interaction.guild, linkedUsers, {
          correlationId: context.correlationId,
          command: interaction.commandName,
          guildId: interaction.guildId ?? undefined,
          userId: interaction.user.id,
        })
      : linkedUsers;
    if (filteredLinkedUsers.length === 0) {
      return { error: "No linked handles found in this server yet." };
    }
    if (filteredLinkedUsers.length > MAX_HANDLES) {
      return {
        error: `Too many linked handles (${filteredLinkedUsers.length}). Provide specific handles or users.`,
      };
    }
    for (const linked of filteredLinkedUsers) {
      addTargetHandle(targets, linked.handle, `<@${linked.userId}>`);
    }
  }

  return { targets: Array.from(targets.values()) };
}

export const contestResultsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestresults")
    .setDescription("Shows standings for linked users in a contest")
    .addStringOption((option) =>
      option.setName("query").setDescription("Contest id, URL, name, or latest").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of results to show (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    )
    .addUserOption((option) => option.setName("user1").setDescription("User to include"))
    .addUserOption((option) => option.setName("user2").setDescription("User to include"))
    .addUserOption((option) => option.setName("user3").setDescription("User to include"))
    .addUserOption((option) => option.setName("user4").setDescription("User to include"))
    .addStringOption((option) =>
      option.setName("handles").setDescription("Comma or space separated handles to include")
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
    const handlesRaw = interaction.options.getString("handles")?.trim() ?? "";
    const scope = parseScope(interaction.options.getString("scope"));
    const handleInputs = parseHandleList(handlesRaw);
    const userOptions = getUserOptions([
      interaction.options.getUser("user1"),
      interaction.options.getUser("user2"),
      interaction.options.getUser("user3"),
      interaction.options.getUser("user4"),
    ]);

    if (!interaction.guild && userOptions.length > 0) {
      await interaction.reply({
        content: "Specify handles directly when using this command outside a server.",
      });
      return;
    }

    if (!interaction.guild && handleInputs.length === 0) {
      await interaction.reply({
        content: "Provide at least one handle or run this command in a server.",
      });
      return;
    }

    await interaction.deferReply();

    const refreshResult = await refreshContestData(scope, context.services.contests);
    if ("error" in refreshResult) {
      await interaction.editReply(refreshResult.error);
      return;
    }
    const stale = refreshResult.stale;

    try {
      const lookup = lookupContest(queryRaw, scope, context.services.contests);
      switch (lookup.status) {
        case "missing_latest":
          await interaction.editReply("No finished contests found yet.");
          return;
        case "missing_id":
          await interaction.editReply("No contest found with that ID.");
          return;
        case "missing_name":
          await interaction.editReply("No contests found matching that name.");
          return;
        case "ambiguous": {
          const embed = buildMatchEmbed(queryRaw, lookup.matches, scope);
          if (stale) {
            embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
          }
          await interaction.editReply({ embeds: [embed] });
          return;
        }
        case "ok":
          break;
      }

      const contest = lookup.contest;

      const targetResult = await buildTargets(
        context,
        {
          guildId: interaction.guildId,
          commandName: interaction.commandName,
          user: interaction.user,
          guild: interaction.guild,
        },
        userOptions,
        handleInputs
      );
      if ("error" in targetResult) {
        await interaction.editReply(targetResult.error);
        return;
      }
      const targetList = targetResult.targets;
      if (targetList.length === 0) {
        await interaction.editReply("No handles found to check.");
        return;
      }

      const standings = await context.services.contestStandings.getStandings(
        contest.id,
        targetList.map((target) => target.handle),
        contest.phase
      );

      const entryMap = new Map(
        standings.entries.map((entry) => [entry.handle.toLowerCase(), entry])
      );

      const found: Array<
        TargetHandle & {
          rank: number;
          points: number;
          penalty: number;
          participantType: string;
        }
      > = [];
      const missing: TargetHandle[] = [];

      for (const target of targetList) {
        const entry = entryMap.get(target.handle.toLowerCase());
        if (!entry) {
          missing.push(target);
          continue;
        }
        found.push({ ...target, ...entry });
      }

      const embed = buildContestEmbed(contest);
      const scopeLabel = formatContestTag(contest, scope);
      if (scopeLabel) {
        embed.addFields({ name: "Section", value: scopeLabel, inline: true });
      }
      const footerNotes: string[] = [];

      if (found.length === 0) {
        embed.addFields({
          name: "Standings",
          value:
            contest.phase === "BEFORE"
              ? "Contest has not started yet."
              : "No standings found for the selected handles.",
          inline: false,
        });
      } else {
        const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
        const sorted = found.sort((a, b) => a.rank - b.rank);
        const lines = sorted.slice(0, limit).map((entry) => {
          const display = entry.label.startsWith("<@")
            ? `${entry.label} (${entry.handle})`
            : entry.label;
          const rank = entry.rank > 0 ? `#${entry.rank}` : "Unranked";
          const points = formatPoints(entry.points);
          const penalty = Number.isFinite(entry.penalty) ? String(entry.penalty) : "0";
          const typeLabel =
            entry.participantType && entry.participantType !== "CONTESTANT"
              ? ` • ${formatParticipantType(entry.participantType)}`
              : "";
          return `${rank} ${display} • ${points} pts • ${penalty} pen${typeLabel}`;
        });

        embed.addFields({ name: "Standings", value: lines.join("\n"), inline: false });

        if (found.length > limit) {
          footerNotes.push(`Showing top ${limit} of ${found.length} entries.`);
        }
      }

      if (missing.length > 0) {
        const preview = missing
          .slice(0, 10)
          .map((entry) => entry.label)
          .join(", ");
        const suffix = missing.length > 10 ? `\n...and ${missing.length - 10} more.` : "";
        embed.addFields({
          name: "Not found",
          value: `${preview}${suffix}`,
          inline: false,
        });
      }

      if (stale || standings.isStale) {
        footerNotes.push("Showing cached data due to a temporary Codeforces error.");
      }

      if (footerNotes.length > 0) {
        embed.setFooter({ text: footerNotes.join(" ") });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contestresults: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
