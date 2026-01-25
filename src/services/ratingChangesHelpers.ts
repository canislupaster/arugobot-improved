import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { buildServiceError } from "../utils/errors.js";

import type { RatingChangesCacheKey, RatingChangesCacheResult } from "./ratingChangesCache.js";
import { resolveRatingChangesWithCache } from "./ratingChangesCache.js";

export type RatingChangesLookup<T> = {
  result: RatingChangesCacheResult<T> | null;
  lastError: { message: string; timestamp: string } | null;
};

export async function fetchRatingChangesWithTracking<T>(
  db: Kysely<Database>,
  key: RatingChangesCacheKey,
  ttlMs: number,
  fetcher: () => Promise<T[]>,
  parsePayload: (payload: string) => T[],
  warnMessage: string,
  warnContext: Record<string, unknown>
): Promise<RatingChangesLookup<T>> {
  const { result, errorMessage } = await resolveRatingChangesWithCache(
    db,
    key,
    ttlMs,
    fetcher,
    parsePayload,
    warnMessage,
    warnContext
  );

  return {
    result,
    lastError: buildServiceError(errorMessage),
  };
}
