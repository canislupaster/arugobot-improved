import type { ChatInputCommandInteraction } from "discord.js";

import type { Contest, ContestScopeFilter, ContestService } from "../services/contests.js";
import type { Problem, ProblemService } from "../services/problems.js";
import type { ContestSolvesResult, StoreService } from "../services/store.js";

import type { ContestLookupService } from "./contestLookup.js";
import { resolveContestOrReply } from "./contestLookup.js";
import type { ContestProblemSummary } from "./contestProblems.js";
import { formatUnsolvedProblemsValue, getContestProblems } from "./contestProblems.js";
import { parseContestScope, refreshContestData } from "./contestScope.js";
import { resolveBoundedIntegerOption } from "./interaction.js";

export type ContestSolvesDataResult =
  | { status: "ok"; contestProblems: Problem[]; contestSolves: ContestSolvesResult }
  | { status: "no_problems" }
  | { status: "no_solves" };

export function getContestSolvesDataMessage(result: ContestSolvesDataResult): string | null {
  if (result.status === "no_problems") {
    return "No contest problems found in the cache yet.";
  }
  if (result.status === "no_solves") {
    return "Contest submissions cache not ready yet. Try again soon.";
  }
  return null;
}

export function shouldShowContestSolvesStale(
  refreshWasStale: boolean,
  contestSolves: ContestSolvesResult
): boolean {
  return refreshWasStale || contestSolves.isStale;
}

const CONTEST_SOLVES_STALE_FOOTER =
  "Showing cached data due to a temporary Codeforces error.";

export function getContestSolvesStaleFooter(
  refreshWasStale: boolean,
  contestSolves: ContestSolvesResult
): string | null {
  return shouldShowContestSolvesStale(refreshWasStale, contestSolves)
    ? CONTEST_SOLVES_STALE_FOOTER
    : null;
}

type ContestSolvesFooterTarget = {
  setFooter: (options: { text: string }) => unknown;
};

export function applyContestSolvesStaleFooter(
  embed: ContestSolvesFooterTarget,
  refreshWasStale: boolean,
  contestSolves: ContestSolvesResult
): boolean {
  const footer = getContestSolvesStaleFooter(refreshWasStale, contestSolves);
  if (!footer) {
    return false;
  }
  embed.setFooter({ text: footer });
  return true;
}

export function formatContestSolvesSummary(options: {
  totalProblems: number;
  solvedCount: number;
  unsolvedCount: number;
  handleCount?: number;
}): string {
  const lines: string[] = [];
  if (options.handleCount !== undefined) {
    lines.push(`Handles included: ${options.handleCount}`);
  }
  lines.push(`Solved problems: ${options.solvedCount}/${options.totalProblems}`);
  lines.push(`Unsolved problems: ${options.unsolvedCount}`);
  return lines.join("\n");
}

export function buildContestSolvesSummaryFields(options: {
  totalProblems: number;
  solvedCount: number;
  unsolvedCount: number;
  handleCount?: number;
  unsolved: ContestProblemSummary[];
  limit: number;
  emptyMessage: string;
  isGym?: boolean;
}): Array<{ name: string; value: string; inline: boolean }> {
  return [
    {
      name: "Summary",
      value: formatContestSolvesSummary({
        totalProblems: options.totalProblems,
        solvedCount: options.solvedCount,
        unsolvedCount: options.unsolvedCount,
        handleCount: options.handleCount,
      }),
      inline: false,
    },
    {
      name: "Unsolved problems",
      value: formatUnsolvedProblemsValue(
        options.unsolved,
        options.limit,
        options.emptyMessage,
        { isGym: options.isGym }
      ),
      inline: false,
    },
  ];
}

export type ContestSolvesOptionsResult =
  | { status: "ok"; queryRaw: string; scope: ContestScopeFilter; limit: number }
  | { status: "error"; message: string };

type ContestSolvesOptionsInteraction = {
  options: {
    getString: {
      (name: string, required: true): string;
      (name: string, required?: false): string | null;
      (name: string, required?: boolean): string | null;
    };
    getInteger: (name: string) => number | null;
  };
};

export function resolveContestSolvesOptions(
  interaction: ContestSolvesOptionsInteraction,
  options: { defaultLimit: number; maxLimit: number }
): ContestSolvesOptionsResult {
  const queryRaw = interaction.options.getString("query", true).trim();
  const scope = parseContestScope(interaction.options.getString("scope"));
  const resolvedLimit = resolveBoundedIntegerOption(interaction, {
    name: "limit",
    defaultValue: options.defaultLimit,
    min: 1,
    max: options.maxLimit,
    errorMessage: "Invalid limit.",
  });
  if ("error" in resolvedLimit) {
    return { status: "error", message: resolvedLimit.error };
  }
  return { status: "ok", queryRaw, scope, limit: resolvedLimit.value };
}

export async function resolveContestSolvesOptionsOrReply(
  interaction: ContestSolvesOptionsInteraction & {
    reply: (options: { content: string }) => Promise<unknown>;
  },
  options: { defaultLimit: number; maxLimit: number }
): Promise<{ status: "ok"; queryRaw: string; scope: ContestScopeFilter; limit: number } | {
  status: "replied";
}> {
  const result = resolveContestSolvesOptions(interaction, options);
  if (result.status === "error") {
    await interaction.reply({ content: result.message });
    return { status: "replied" };
  }
  return result;
}

export type ContestSolvesContextResult =
  | {
      status: "ok";
      contest: Contest;
      refreshWasStale: boolean;
    }
  | { status: "replied" };

type ContestSolvesContextOptions = {
  interaction: ChatInputCommandInteraction;
  queryRaw: string;
  scope: ContestScopeFilter;
  contests: ContestLookupService & Pick<ContestService, "refresh" | "getLastRefreshAt">;
  maxMatches?: number;
  footerText: string;
};

export async function resolveContestSolvesContext(
  options: ContestSolvesContextOptions
): Promise<ContestSolvesContextResult> {
  const refreshResult = await refreshContestData(options.contests, options.scope);
  if ("error" in refreshResult) {
    await options.interaction.editReply(refreshResult.error);
    return { status: "replied" };
  }

  const lookup = await resolveContestOrReply(
    options.interaction,
    options.queryRaw,
    options.scope,
    options.contests,
    {
      maxMatches: options.maxMatches,
      footerText: options.footerText,
      refreshWasStale: refreshResult.stale,
    }
  );
  if (lookup.status === "replied") {
    return { status: "replied" };
  }

  return {
    status: "ok",
    contest: lookup.contest,
    refreshWasStale: refreshResult.stale,
  };
}

type ContestSolvesLoadOptions = {
  ttlMs?: number;
};

export async function loadContestSolvesData(
  problems: Pick<ProblemService, "ensureProblemsLoaded">,
  store: Pick<StoreService, "getContestSolvesResult">,
  contestId: number,
  options: ContestSolvesLoadOptions = {}
): Promise<ContestSolvesDataResult> {
  const allProblems = await problems.ensureProblemsLoaded();
  const contestProblems = getContestProblems(allProblems, contestId);
  if (contestProblems.length === 0) {
    return { status: "no_problems" };
  }

  const contestSolves = await store.getContestSolvesResult(contestId, options.ttlMs);
  if (!contestSolves) {
    return { status: "no_solves" };
  }

  return { status: "ok", contestProblems, contestSolves };
}

export async function loadContestSolvesDataOrReply(
  interaction: Pick<ChatInputCommandInteraction, "editReply">,
  problems: Pick<ProblemService, "ensureProblemsLoaded">,
  store: Pick<StoreService, "getContestSolvesResult">,
  contestId: number,
  options: ContestSolvesLoadOptions = {}
): Promise<
  | { status: "ok"; contestProblems: Problem[]; contestSolves: ContestSolvesResult }
  | { status: "replied" }
> {
  const contestData = await loadContestSolvesData(problems, store, contestId, options);
  if (contestData.status !== "ok") {
    await interaction.editReply(
      getContestSolvesDataMessage(contestData) ?? "No contest data available."
    );
    return { status: "replied" };
  }
  return contestData;
}

type ContestSolvesPayloadResult =
  | {
      status: "ok";
      contest: Contest;
      refreshWasStale: boolean;
      contestProblems: Problem[];
      contestSolves: ContestSolvesResult;
    }
  | { status: "replied" };

export async function resolveContestSolvesPayloadOrReply(
  options: ContestSolvesContextOptions & {
    problems: Pick<ProblemService, "ensureProblemsLoaded">;
    store: Pick<StoreService, "getContestSolvesResult">;
    ttlMs?: number;
  }
): Promise<ContestSolvesPayloadResult> {
  const contestResult = await resolveContestSolvesContext(options);
  if (contestResult.status === "replied") {
    return { status: "replied" };
  }

  const contestData = await loadContestSolvesDataOrReply(
    options.interaction,
    options.problems,
    options.store,
    contestResult.contest.id,
    { ttlMs: options.ttlMs }
  );
  if (contestData.status === "replied") {
    return { status: "replied" };
  }

  return {
    status: "ok",
    contest: contestResult.contest,
    refreshWasStale: contestResult.refreshWasStale,
    contestProblems: contestData.contestProblems,
    contestSolves: contestData.contestSolves,
  };
}
