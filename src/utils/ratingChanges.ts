import type { RatingChange } from "../services/ratingChanges.js";

type FormatDeltaOptions = {
  round?: boolean;
  includeZeroSign?: boolean;
};

export function formatRatingDelta(delta: number, options: FormatDeltaOptions = {}): string {
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
    return parsed;
  } catch {
    return [];
  }
}
