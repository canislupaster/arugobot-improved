import type { Problem } from "../services/problems.js";

import { normalizeHandleKey } from "./handles.js";

export type ContestSolveEntry = {
  handle: string;
  contestId: number;
  index: string;
};

export type ContestProblemSummary = {
  problem: Problem;
  solvedBy: Set<string>;
};

export type ContestSolveSplit = {
  summaries: ContestProblemSummary[];
  solved: ContestProblemSummary[];
  unsolved: ContestProblemSummary[];
};

export function compareProblemIndex(a: Problem, b: Problem): number {
  return a.index.localeCompare(b.index, "en", { numeric: true });
}

export function getContestProblems(problems: Problem[], contestId: number): Problem[] {
  return problems.filter((problem) => problem.contestId === contestId).sort(compareProblemIndex);
}

export function buildProblemLink(problem: Problem): string {
  return `https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`;
}

export function formatContestProblemLine(
  problem: Problem,
  solvedCount?: number | null
): string {
  const label = `[${problem.index}. ${problem.name}](${buildProblemLink(problem)})`;
  if (solvedCount === null || solvedCount === undefined) {
    return label;
  }
  return `${label} • ${solvedCount} solved`;
}

export function summarizeContestSolves(
  problems: Problem[],
  solves: ContestSolveEntry[],
  handleMap: Map<string, string>
): ContestProblemSummary[] {
  const normalizedHandleMap = new Map<string, string>();
  for (const [handle, value] of handleMap.entries()) {
    normalizedHandleMap.set(normalizeHandleKey(handle), value);
  }

  const solvedByProblem = new Map<string, Set<string>>();
  for (const solve of solves) {
    const key = normalizeHandleKey(solve.handle);
    const mapped = normalizedHandleMap.get(key);
    if (!mapped) {
      continue;
    }
    const problemKey = `${solve.contestId}-${solve.index}`;
    const entry = solvedByProblem.get(problemKey) ?? new Set<string>();
    entry.add(mapped);
    solvedByProblem.set(problemKey, entry);
  }

  return problems.map((problem) => {
    const problemKey = `${problem.contestId}-${problem.index}`;
    return {
      problem,
      solvedBy: solvedByProblem.get(problemKey) ?? new Set<string>(),
    };
  });
}

export function splitContestSolves(
  problems: Problem[],
  solves: ContestSolveEntry[],
  handleMap: Map<string, string>
): ContestSolveSplit {
  const summaries = summarizeContestSolves(problems, solves, handleMap);
  const solved = summaries.filter((entry) => entry.solvedBy.size > 0);
  const unsolved = summaries.filter((entry) => entry.solvedBy.size === 0);
  return { summaries, solved, unsolved };
}
