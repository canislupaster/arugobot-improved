import type { Problem } from "../services/problems.js";

import type { RatingRange } from "./ratingRanges.js";

export type TagFilters = {
  include: string[];
  exclude: string[];
};

export function getProblemId(problem: Problem): string {
  return `${problem.contestId}${problem.index}`;
}

export function parseTagFilters(raw: string | null | undefined): TagFilters {
  const include = new Set<string>();
  const exclude = new Set<string>();
  if (!raw) {
    return { include: [], exclude: [] };
  }
  for (const token of raw.split(/[,\s]+/)) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }
    const isExcluded = trimmed.startsWith("-");
    const tag = (isExcluded ? trimmed.slice(1) : trimmed).toLowerCase();
    if (!tag) {
      continue;
    }
    if (isExcluded) {
      exclude.add(tag);
    } else {
      include.add(tag);
    }
  }
  return { include: [...include], exclude: [...exclude] };
}

export function filterProblemsByTags(problems: Problem[], filters: TagFilters): Problem[] {
  if (filters.include.length === 0 && filters.exclude.length === 0) {
    return problems;
  }
  const includeSet = new Set(filters.include.map((tag) => tag.toLowerCase()));
  const excludeSet = new Set(filters.exclude.map((tag) => tag.toLowerCase()));
  return problems.filter((problem) => {
    const tags = new Set(problem.tags.map((tag) => tag.toLowerCase()));
    for (const tag of excludeSet) {
      if (tags.has(tag)) {
        return false;
      }
    }
    for (const tag of includeSet) {
      if (!tags.has(tag)) {
        return false;
      }
    }
    return true;
  });
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
