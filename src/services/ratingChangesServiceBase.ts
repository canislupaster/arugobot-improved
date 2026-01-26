import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";

import type { RatingChangesCacheKey, RatingChangesCacheResult } from "./ratingChangesCache.js";
import { fetchRatingChangesWithTracking } from "./ratingChangesHelpers.js";

export type RatingChangesServiceError = { message: string; timestamp: string } | null;

type FetchWithTrackingParams<T> = {
  key: RatingChangesCacheKey;
  ttlMs: number;
  fetcher: () => Promise<T[]>;
  parsePayload: (payload: string) => T[];
  warnMessage: string;
  warnContext: Record<string, unknown>;
};

export abstract class RatingChangesServiceBase {
  protected lastError: RatingChangesServiceError = null;

  constructor(protected db: Kysely<Database>) {}

  getLastError(): RatingChangesServiceError {
    return this.lastError;
  }

  protected async fetchWithTracking<T>(
    params: FetchWithTrackingParams<T>
  ): Promise<RatingChangesCacheResult<T> | null> {
    const { result, lastError } = await fetchRatingChangesWithTracking(
      this.db,
      params.key,
      params.ttlMs,
      params.fetcher,
      params.parsePayload,
      params.warnMessage,
      params.warnContext
    );

    this.lastError = lastError;

    return result;
  }
}
