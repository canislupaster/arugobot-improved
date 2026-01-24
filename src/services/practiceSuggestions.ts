import {
  filterProblemsByRatingRanges,
  filterProblemsByTags,
  parseTagFilters,
  selectRandomProblem,
} from "../utils/problemSelection.js";
import type { RatingRange } from "../utils/ratingRanges.js";

import type { Problem, ProblemService } from "./problems.js";
import type { StoreService } from "./store.js";

export type PracticeSuggestionResult =
  | { status: "no_problems"; handle: string }
  | { status: "no_solved"; handle: string }
  | {
      status: "no_candidates";
      handle: string;
      candidateCount: number;
      excludedCount: number;
      solvedCount: number;
      isStale: boolean;
      source: "cache" | "api";
    }
  | {
      status: "ok";
      handle: string;
      problem: Problem;
      candidateCount: number;
      excludedCount: number;
      solvedCount: number;
      isStale: boolean;
      source: "cache" | "api";
    };

export type PracticeSuggestionOptions = {
  ratingRanges: RatingRange[];
  tags: string;
  excludedIds?: Set<string>;
};

export class PracticeSuggestionService {
  constructor(
    private problems: ProblemService,
    private store: StoreService
  ) {}

  async suggestProblem(
    handle: string,
    options: PracticeSuggestionOptions
  ): Promise<PracticeSuggestionResult> {
    const problems = await this.problems.ensureProblemsLoaded();
    if (problems.length === 0) {
      return { status: "no_problems", handle };
    }

    const tagFilters = parseTagFilters(options.tags);
    const rated = filterProblemsByRatingRanges(problems, options.ratingRanges);
    const candidates = filterProblemsByTags(rated, tagFilters);

    const solvedResult = await this.store.getSolvedProblemsResult(handle);
    if (!solvedResult) {
      return { status: "no_solved", handle };
    }

    const excluded = new Set(options.excludedIds ?? []);
    for (const solvedId of solvedResult.solved) {
      excluded.add(solvedId);
    }

    const problem = selectRandomProblem(candidates, excluded);
    const base = {
      handle,
      candidateCount: candidates.length,
      excludedCount: excluded.size,
      solvedCount: solvedResult.solved.length,
      isStale: solvedResult.isStale,
      source: solvedResult.source,
    };

    if (!problem) {
      return { status: "no_candidates", ...base };
    }

    return { status: "ok", problem, ...base };
  }
}
