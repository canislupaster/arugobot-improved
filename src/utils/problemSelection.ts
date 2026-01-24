import type { Problem } from "../services/problems.js";

import type { RatingRange } from "./ratingRanges.js";

export function getProblemId(problem: Problem): string {
  return `${problem.contestId}${problem.index}`;
}

export function filterProblemsByRatingRange(
  problems: Problem[],
  minRating: number,
  maxRating: number
): Problem[] {
  return problems.filter(
    (problem) =>
      problem.rating !== undefined && problem.rating >= minRating && problem.rating <= maxRating
  );
}

export function filterProblemsByRatingRanges(
  problems: Problem[],
  ranges: RatingRange[]
): Problem[] {
  if (ranges.length === 0) {
    return [];
  }
  return problems.filter((problem) => {
    if (problem.rating === undefined) {
      return false;
    }
    return ranges.some((range) => problem.rating! >= range.min && problem.rating! <= range.max);
  });
}

export function selectRandomProblems(
  problems: Problem[],
  excludedIds: Set<string>,
  limit: number
): Problem[] {
  const remaining = problems.filter((problem) => !excludedIds.has(getProblemId(problem)));
  for (let i = remaining.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  return remaining.slice(0, limit);
}

export function selectRandomProblem(problems: Problem[], excludedIds: Set<string>): Problem | null {
  const [picked] = selectRandomProblems(problems, excludedIds, 1);
  return picked ?? null;
}
