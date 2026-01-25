import type { RatingChange } from "../services/ratingChanges.js";

export function parseRatingChangesPayload(payload: string): RatingChange[] {
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
