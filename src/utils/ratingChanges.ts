import type { RatingChange } from "../services/ratingChanges.js";

type FormatDeltaOptions = {
  round?: boolean;
  includeZeroSign?: boolean;
};

export function formatRatingDelta(delta: number, options: FormatDeltaOptions = {}): string {
  if (!Number.isFinite(delta)) {
    return "0";
  }
  const value = options.round ? Math.round(delta) : delta;
  const includeZeroSign = options.includeZeroSign ?? true;
  const shouldPrefixPlus = value > 0 || (value === 0 && includeZeroSign);
  return shouldPrefixPlus ? `+${value}` : String(value);
}

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
