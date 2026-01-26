import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { normalizeHandleKey } from "../utils/handles.js";
import { parseRatingChangesPayload } from "../utils/ratingChanges.js";

import type { CodeforcesClient } from "./codeforces.js";
import type { RatingChangesCacheResult } from "./ratingChangesCache.js";
import { RatingChangesServiceBase } from "./ratingChangesServiceBase.js";

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

export type RatingChangesResult = RatingChangesCacheResult<RatingChange>;

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

export class RatingChangesService extends RatingChangesServiceBase {
  constructor(
    db: Kysely<Database>,
    private client: Pick<CodeforcesClient, "request">
  ) {
    super(db);
  }

  async getRatingChanges(
    handle: string,
    ttlMs = DEFAULT_CACHE_TTL_MS
  ): Promise<RatingChangesResult | null> {
    const key = normalizeHandleKey(handle);
    return this.fetchWithTracking({
      key: { type: "handle", handle: key },
      ttlMs,
      fetcher: () => this.client.request<RatingChangesResponse>("user.rating", { handle }),
      parsePayload: parseRatingChangesPayload,
      warnMessage: "Rating change request failed; using cached data if available.",
      warnContext: { handle: key },
    });
  }
}
