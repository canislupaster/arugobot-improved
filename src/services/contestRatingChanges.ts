import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { parseRatingChangesPayload } from "../utils/ratingChanges.js";

import type { CodeforcesClient } from "./codeforces.js";
import type { RatingChange } from "./ratingChanges.js";
import type { RatingChangesCacheResult } from "./ratingChangesCache.js";
import { RatingChangesServiceBase } from "./ratingChangesServiceBase.js";

export type ContestRatingChangesResult = RatingChangesCacheResult<RatingChange>;

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export class ContestRatingChangesService extends RatingChangesServiceBase {
  constructor(
    db: Kysely<Database>,
    private client: Pick<CodeforcesClient, "request">
  ) {
    super(db);
  }

  async getContestRatingChanges(
    contestId: number,
    ttlMs = DEFAULT_CACHE_TTL_MS
  ): Promise<ContestRatingChangesResult | null> {
    return this.fetchWithTracking({
      key: { type: "contest", contestId },
      ttlMs,
      fetcher: () => this.client.request<RatingChange[]>("contest.ratingChanges", { contestId }),
      parsePayload: parseRatingChangesPayload,
      warnMessage: "Contest rating changes request failed; using cached data if available.",
      warnContext: { contestId },
    });
  }
}
