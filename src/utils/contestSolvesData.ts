import type { ChatInputCommandInteraction } from "discord.js";

import type { Contest, ContestScopeFilter, ContestService } from "../services/contests.js";
import type { Problem, ProblemService } from "../services/problems.js";
import type { ContestSolvesResult, StoreService } from "../services/store.js";

import type { ContestLookupService } from "./contestLookup.js";
import { resolveContestOrReply } from "./contestLookup.js";
import { getContestProblems } from "./contestProblems.js";
import { refreshContestData } from "./contestScope.js";

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

export async function loadContestSolvesData(
  problems: Pick<ProblemService, "ensureProblemsLoaded">,
  store: Pick<StoreService, "getContestSolvesResult">,
  contestId: number
): Promise<ContestSolvesDataResult> {
  const allProblems = await problems.ensureProblemsLoaded();
  const contestProblems = getContestProblems(allProblems, contestId);
  if (contestProblems.length === 0) {
    return { status: "no_problems" };
  }

  const contestSolves = await store.getContestSolvesResult(contestId);
  if (!contestSolves) {
    return { status: "no_solves" };
  }

  return { status: "ok", contestProblems, contestSolves };
}
