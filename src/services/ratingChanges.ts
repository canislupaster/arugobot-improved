import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { isCacheFresh } from "../utils/cache.js";
import { logError, logWarn } from "../utils/logger.js";

import type { CodeforcesClient } from "./codeforces.js";

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

type RatingChangesCacheRow = {
  payload: string;
  last_fetched: string;
};

export type RatingChangesResult = {
  changes: RatingChange[];
  source: "cache" | "api";
  isStale: boolean;
};

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function parseChanges(payload: string): RatingChange[] {
  try {
    const parsed = JSON.parse(payload) as RatingChange[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry) =>
        Number.isFinite(entry.contestId) &&
        Number.isFinite(entry.rank) &&
        Number.isFinite(entry.oldRating) &&
        Number.isFinite(entry.newRating) &&
        Number.isFinite(entry.ratingUpdateTimeSeconds)
    );
  } catch {
    return [];
  }
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
    let cached: RatingChangesCacheRow | undefined;

    try {
      cached = await this.db
        .selectFrom("cf_rating_changes")
        .select(["payload", "last_fetched"])
        .where("handle", "=", key)
        .executeTakeFirst();
    } catch (error) {
      logError(`Database error: ${String(error)}`);
    }

    if (cached && isCacheFresh(cached.last_fetched, ttlMs)) {
      return { changes: parseChanges(cached.payload), source: "cache", isStale: false };
    }

    try {
      const response = await this.client.request<RatingChangesResponse>("user.rating", {
        handle,
      });
      const payload = JSON.stringify(response);
      const timestamp = new Date().toISOString();
      await this.db
        .insertInto("cf_rating_changes")
        .values({
          handle: key,
          payload,
          last_fetched: timestamp,
        })
        .onConflict((oc) =>
          oc.column("handle").doUpdateSet({
            payload,
            last_fetched: timestamp,
          })
        )
        .execute();
      this.lastError = null;
      return { changes: response, source: "api", isStale: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logWarn("Rating change request failed; using cached data if available.", {
        handle: key,
        error: message,
      });
      if (cached) {
        return { changes: parseChanges(cached.payload), source: "cache", isStale: true };
      }
      return null;
    }
  }
}
