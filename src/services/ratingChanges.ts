import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { parseRatingChangesPayload } from "../utils/ratingChanges.js";

import type { CodeforcesClient } from "./codeforces.js";
import {
  resolveRatingChangesWithCache,
} from "./ratingChangesCache.js";

export type RatingChange = {
  handle?: string;
  contestId: number;
  contestName: string;
  rank: number;
  oldRating: number;
  newRating: number;
  ratingUpdateTimeSeconds: number;
};

type RatingChangesResponse = RatingChange[];

export type RatingChangesResult = {
  changes: RatingChange[];
  source: "cache" | "api";
  isStale: boolean;
};

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

export class RatingChangesService {
  private lastError: { message: string; timestamp: string } | null = null;

  constructor(
    private db: Kysely<Database>,
    private client: Pick<CodeforcesClient, "request">
  ) {}

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async getRatingChanges(
    handle: string,
    ttlMs = DEFAULT_CACHE_TTL_MS
  ): Promise<RatingChangesResult | null> {
    const key = normalizeHandle(handle);
    const { result, errorMessage } = await resolveRatingChangesWithCache(
      this.db,
      { type: "handle", handle: key },
      ttlMs,
      () => this.client.request<RatingChangesResponse>("user.rating", { handle }),
      parseRatingChangesPayload,
      "Rating change request failed; using cached data if available.",
      { handle: key }
    );

    if (errorMessage) {
      this.lastError = { message: errorMessage, timestamp: new Date().toISOString() };
    } else {
      this.lastError = null;
    }

    return result;
  }
}
