import type { Problem } from "../services/problems.js";

import { normalizeHandleKey } from "./handles.js";

type ContestSolveEntry = {
  handle: string;
  contestId: number;
  index: string;
};

export type ContestProblemSummary = {
  problem: Problem;
  solvedBy: Set<string>;
};

export function compareProblemIndex(a: Problem, b: Problem): number {
  return a.index.localeCompare(b.index, "en", { numeric: true });
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
