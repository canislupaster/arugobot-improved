export type RatingRange = {
  min: number;
  max: number;
};

export type RatingRangeResolution = {
  ranges: RatingRange[];
  error?: string;
};

export function formatRatingRanges(ranges: RatingRange[], fallback?: RatingRange): string {
  const resolved = ranges.length === 0 && fallback ? [fallback] : ranges;
  return resolved
    .map((range) => (range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`))
    .join(", ");
}

export function formatRatingRangesWithDefaults(
  ranges: RatingRange[],
  defaultMin: number,
  defaultMax: number
): string {
  return formatRatingRanges(ranges, { min: defaultMin, max: defaultMax });
}

type RatingRangeInput = {
  rating: number | null;
  minRating: number | null;
  maxRating: number | null;
  rangesRaw: string | null;
  defaultMin: number;
  defaultMax: number;
};

type RatingRangeParseOptions = {
  defaultMax?: number;
};

function parseRangeToken(token: string, options: RatingRangeParseOptions): RatingRangeResolution {
  const plusMatch = token.match(/^(\d+)\+$/);
  if (plusMatch) {
    const min = Number(plusMatch[1]);
    if (!Number.isFinite(min)) {
      return { ranges: [], error: `Invalid range "${token}".` };
    }
    if (min < 0) {
      return { ranges: [], error: "Ratings must be non-negative integers." };
    }
    const resolvedMax =
      typeof options.defaultMax === "number" && Number.isFinite(options.defaultMax)
        ? options.defaultMax
        : null;
    if (resolvedMax === null) {
      return {
        ranges: [],
        error: `Open-ended range "${token}" needs a maximum. Use 800-1200 or 1200.`,
      };
    }
    if (min > resolvedMax) {
      return { ranges: [], error: `Invalid range "${token}" (min > max).` };
    }
    return { ranges: [{ min, max: resolvedMax }] };
  }

  const match = token.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return { ranges: [], error: `Invalid range "${token}". Use 800-1200, 1200, or 1200+.` };
  }
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { ranges: [], error: `Invalid range "${token}".` };
  }
  if (min < 0 || max < 0) {
    return { ranges: [], error: "Ratings must be non-negative integers." };
  }
  if (min > max) {
    return { ranges: [], error: `Invalid range "${token}" (min > max).` };
  }
  return { ranges: [{ min, max }] };
}

export function parseRatingRanges(
  raw: string,
  options: RatingRangeParseOptions = {}
): RatingRangeResolution {
  const tokens = raw
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return { ranges: [], error: "Provide rating ranges like 800-1200, 1400, 1600-1800." };
  }

  const ranges: RatingRange[] = [];
  for (const token of tokens) {
    const result = parseRangeToken(token, options);
    if (result.error) {
      return { ranges: [], error: result.error };
    }
    ranges.push(...result.ranges);
  }

  return { ranges };
}

export function resolveRatingRanges({
  rating,
  minRating,
  maxRating,
  rangesRaw,
  defaultMin,
  defaultMax,
}: RatingRangeInput): RatingRangeResolution {
  const hasRating = rating !== null;
  const hasMinMax = minRating !== null || maxRating !== null;
  const hasRanges = Boolean(rangesRaw?.trim());

  if ((hasRating && (hasMinMax || hasRanges)) || (hasMinMax && hasRanges)) {
    return { ranges: [], error: "Use rating, min/max, or ranges, not a mix." };
  }

  if (hasRanges) {
    return parseRatingRanges(rangesRaw ?? "", { defaultMax });
  }

  if (hasRating) {
    if (rating < 0) {
      return { ranges: [], error: "Ratings must be non-negative integers." };
    }
    return { ranges: [{ min: rating, max: rating }] };
  }

  const resolvedMin = minRating ?? defaultMin;
  const resolvedMax = maxRating ?? defaultMax;

  if (resolvedMin < 0 || resolvedMax < 0) {
    return { ranges: [], error: "Ratings must be non-negative integers." };
  }
  if (resolvedMin > resolvedMax) {
    return { ranges: [], error: "Minimum rating cannot exceed maximum rating." };
  }

  return { ranges: [{ min: resolvedMin, max: resolvedMax }] };
}
