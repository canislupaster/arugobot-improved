import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError, logWarn } from "../utils/logger.js";

import type { CodeforcesClient } from "./codeforces.js";
import type { RatingChange } from "./ratingChanges.js";

type ContestRatingChangesRow = {
  payload: string;
  last_fetched: string;
};

export type ContestRatingChangesResult = {
  changes: RatingChange[];
  source: "cache" | "api";
  isStale: boolean;
};

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function isCacheFresh(lastFetched: string, ttlMs: number): boolean {
  if (!lastFetched || ttlMs <= 0) {
    return false;
  }
  const timestamp = Date.parse(lastFetched);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const ageMs = Date.now() - timestamp;
  return ageMs >= 0 && ageMs <= ttlMs;
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
    let cached: ContestRatingChangesRow | undefined;
    try {
      cached = await this.db
        .selectFrom("contest_rating_changes")
        .select(["payload", "last_fetched"])
        .where("contest_id", "=", contestId)
        .executeTakeFirst();
    } catch (error) {
      logError(`Database error: ${String(error)}`);
    }

    if (cached && isCacheFresh(cached.last_fetched, ttlMs)) {
      return { changes: parseChanges(cached.payload), source: "cache", isStale: false };
    }

    try {
      const response = await this.client.request<RatingChange[]>("contest.ratingChanges", {
        contestId,
      });
      const payload = JSON.stringify(response);
      const timestamp = new Date().toISOString();
      await this.db
        .insertInto("contest_rating_changes")
        .values({
          contest_id: contestId,
          payload,
          last_fetched: timestamp,
        })
        .onConflict((oc) =>
          oc.column("contest_id").doUpdateSet({
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
      logWarn("Contest rating changes request failed; using cached data if available.", {
        contestId,
        error: message,
      });
      if (cached) {
        return { changes: parseChanges(cached.payload), source: "cache", isStale: true };
      }
      return null;
    }
  }
}
