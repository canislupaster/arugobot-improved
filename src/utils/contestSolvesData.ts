import type { Problem } from "../services/problems.js";
import type { ProblemService } from "../services/problems.js";
import type { ContestSolvesResult, StoreService } from "../services/store.js";

import { getContestProblems } from "./contestProblems.js";

export type ContestSolvesDataResult =
  | { status: "ok"; contestProblems: Problem[]; contestSolves: ContestSolvesResult }
  | { status: "no_problems" }
  | { status: "no_solves" };

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
