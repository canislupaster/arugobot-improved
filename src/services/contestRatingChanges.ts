import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { parseRatingChangesPayload } from "../utils/ratingChanges.js";

import type { CodeforcesClient } from "./codeforces.js";
import type { RatingChange } from "./ratingChanges.js";
import { resolveRatingChangesWithCache } from "./ratingChangesCache.js";

export type ContestRatingChangesResult = {
  changes: RatingChange[];
  source: "cache" | "api";
  isStale: boolean;
};

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export class ContestRatingChangesService {
  private lastError: { message: string; timestamp: string } | null = null;

  constructor(
    private db: Kysely<Database>,
    private client: Pick<CodeforcesClient, "request">
  ) {}

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async getContestRatingChanges(
    contestId: number,
    ttlMs = DEFAULT_CACHE_TTL_MS
  ): Promise<ContestRatingChangesResult | null> {
    const { result, errorMessage } = await resolveRatingChangesWithCache(
      this.db,
      { type: "contest", contestId },
      ttlMs,
      () => this.client.request<RatingChange[]>("contest.ratingChanges", { contestId }),
      parseRatingChangesPayload,
      "Contest rating changes request failed; using cached data if available.",
      { contestId }
    );

    if (errorMessage) {
      this.lastError = { message: errorMessage, timestamp: new Date().toISOString() };
    } else {
      this.lastError = null;
    }

    return result;
  }
}
