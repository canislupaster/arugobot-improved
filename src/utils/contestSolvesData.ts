import type { Problem } from "../services/problems.js";
import type { ProblemService } from "../services/problems.js";
import type { ContestSolvesResult, StoreService } from "../services/store.js";

import { getContestProblems } from "./contestProblems.js";

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
