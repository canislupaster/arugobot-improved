import type { Problem } from "../services/problems.js";

import { normalizeHandleKey } from "./handles.js";
import { buildProblemUrl } from "./problemReference.js";

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

export function buildProblemLink(
  problem: Pick<Problem, "contestId" | "index">,
  options: { isGym?: boolean } = {}
): string {
  return buildProblemUrl(problem.contestId, problem.index, options);
}

export function formatContestProblemLine(
  problem: Problem,
  solvedCount?: number | null,
  options: { isGym?: boolean } = {}
): string {
  const label = `[${problem.index}. ${problem.name}](${buildProblemLink(problem, options)})`;
  if (solvedCount === null || solvedCount === undefined) {
    return label;
  }
  return `${label} • ${solvedCount} solved`;
}

export function formatContestProblemLines(
  entries: ContestProblemSummary[],
  limit: number,
  solvedCount?: (entry: ContestProblemSummary) => number | null,
  options: { isGym?: boolean } = {}
): string {
  const resolveSolvedCount = solvedCount ?? (() => null);
  return entries
    .slice(0, limit)
    .map((entry) => formatContestProblemLine(entry.problem, resolveSolvedCount(entry), options))
    .join("\n");
}

export function formatUnsolvedProblemsValue(
  unsolved: ContestProblemSummary[],
  limit: number,
  emptyMessage: string,
  options: { isGym?: boolean } = {}
): string {
  if (unsolved.length === 0) {
    return emptyMessage;
  }
  return formatContestProblemLines(unsolved, limit, undefined, options);
}

function buildContestProblemKey(contestId: number, index: string): string {
  return `${contestId}-${index}`;
}

function normalizeHandleMap(handleMap: Map<string, string>): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [handle, value] of handleMap.entries()) {
    normalized.set(normalizeHandleKey(handle), value);
  }
  return normalized;
}

export function summarizeContestSolves(
  problems: Problem[],
  solves: ContestSolveEntry[],
  handleMap: Map<string, string>
): ContestProblemSummary[] {
  const normalizedHandleMap = normalizeHandleMap(handleMap);

  const solvedByProblem = new Map<string, Set<string>>();
  for (const solve of solves) {
    const key = normalizeHandleKey(solve.handle);
    const mapped = normalizedHandleMap.get(key);
    if (!mapped) {
      continue;
    }
    const problemKey = buildContestProblemKey(solve.contestId, solve.index);
    const entry = solvedByProblem.get(problemKey) ?? new Set<string>();
    entry.add(mapped);
    solvedByProblem.set(problemKey, entry);
  }

  return problems.map((problem) => {
    const problemKey = buildContestProblemKey(problem.contestId, problem.index);
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
