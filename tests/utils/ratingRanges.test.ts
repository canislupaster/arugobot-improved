import { parseRatingRanges, resolveRatingRanges } from "../../src/utils/ratingRanges.js";

describe("parseRatingRanges", () => {
  it("parses single and range tokens", () => {
    const result = parseRatingRanges("800-1000, 1200 1400-1600");
    expect(result.error).toBeUndefined();
    expect(result.ranges).toEqual([
      { min: 800, max: 1000 },
      { min: 1200, max: 1200 },
      { min: 1400, max: 1600 },
    ]);
  });

  it("rejects invalid tokens", () => {
    const result = parseRatingRanges("800-foo");
    expect(result.error).toBe('Invalid range "800-foo". Use 800-1200 or 1200.');
    expect(result.ranges).toEqual([]);
  });
});

describe("resolveRatingRanges", () => {
  it("defaults to the configured range when no inputs are given", () => {
    const result = resolveRatingRanges({
      rating: null,
      minRating: null,
      maxRating: null,
      rangesRaw: null,
      defaultMin: 800,
      defaultMax: 3500,
    });
    expect(result.error).toBeUndefined();
    expect(result.ranges).toEqual([{ min: 800, max: 3500 }]);
  });

  it("rejects mixed inputs", () => {
    const result = resolveRatingRanges({
      rating: 1200,
      minRating: 1000,
      maxRating: null,
      rangesRaw: null,
      defaultMin: 800,
      defaultMax: 3500,
    });
    expect(result.error).toBe("Use rating, min/max, or ranges, not a mix.");
  });
});
