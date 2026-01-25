import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { isCacheFresh } from "../utils/cache.js";
import { logError, logWarn } from "../utils/logger.js";

export type RatingChangesCacheKey =
  | {
      type: "handle";
      handle: string;
    }
  | {
      type: "contest";
      contestId: number;
    };

export type RatingChangesCacheRow = {
  payload: string;
  last_fetched: string;
};

export type RatingChangesCacheResult<T> = {
  changes: T[];
  source: "cache" | "api";
  isStale: boolean;
};

export type RatingChangesLookupResult<T> = {
  result: RatingChangesCacheResult<T> | null;
  errorMessage: string | null;
};

export async function readRatingChangesCache(
  db: Kysely<Database>,
  key: RatingChangesCacheKey
): Promise<RatingChangesCacheRow | null> {
  try {
    if (key.type === "handle") {
      const row = await db
        .selectFrom("cf_rating_changes")
        .select(["payload", "last_fetched"])
        .where("handle", "=", key.handle)
        .executeTakeFirst();
      return row ?? null;
    }
    const row = await db
      .selectFrom("contest_rating_changes")
      .select(["payload", "last_fetched"])
      .where("contest_id", "=", key.contestId)
      .executeTakeFirst();
    return row ?? null;
  } catch (error) {
    logError("Database error loading rating changes cache.", {
      scope: key.type,
      handle: key.type === "handle" ? key.handle : undefined,
      contestId: key.type === "contest" ? key.contestId : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function writeRatingChangesCache(
  db: Kysely<Database>,
  key: RatingChangesCacheKey,
  payload: string,
  timestamp: string
): Promise<void> {
  if (key.type === "handle") {
    await db
      .insertInto("cf_rating_changes")
      .values({
        handle: key.handle,
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
    return;
  }
  await db
    .insertInto("contest_rating_changes")
    .values({
      contest_id: key.contestId,
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
}

export async function resolveRatingChangesWithCache<T>(
  db: Kysely<Database>,
  key: RatingChangesCacheKey,
  ttlMs: number,
  fetcher: () => Promise<T[]>,
  parsePayload: (payload: string) => T[],
  warnMessage: string,
  warnContext: Record<string, unknown>
): Promise<RatingChangesLookupResult<T>> {
  const cached = await readRatingChangesCache(db, key);

  if (cached && isCacheFresh(cached.last_fetched, ttlMs)) {
    return {
      result: {
        changes: parsePayload(cached.payload),
        source: "cache",
        isStale: false,
      },
      errorMessage: null,
    };
  }

  try {
    const response = await fetcher();
    const payload = JSON.stringify(response);
    const timestamp = new Date().toISOString();
    await writeRatingChangesCache(db, key, payload, timestamp);
    return {
      result: { changes: response, source: "api", isStale: false },
      errorMessage: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(warnMessage, { ...warnContext, error: message });
    if (cached) {
      return {
        result: {
          changes: parsePayload(cached.payload),
          source: "cache",
          isStale: true,
        },
        errorMessage: message,
      };
    }
    return { result: null, errorMessage: message };
  }
}
