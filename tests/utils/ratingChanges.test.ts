import { formatRatingDelta, parseRatingChangesPayload } from "../../src/utils/ratingChanges.js";

describe("parseRatingChangesPayload", () => {
  it("filters out invalid rating change entries", () => {
    const payload = JSON.stringify([
      {
        contestId: 1000,
        contestName: "Contest A",
        rank: 1,
        oldRating: 1500,
        newRating: 1600,
        ratingUpdateTimeSeconds: 1700000000,
        handle: "tourist",
      },
      {
        contestId: "bad",
        contestName: "Contest B",
        rank: 2,
        oldRating: 1400,
        newRating: 1450,
        ratingUpdateTimeSeconds: 1700000100,
      },
    ]);

    const result = parseRatingChangesPayload(payload);

    expect(result).toHaveLength(1);
    expect(result[0]?.contestId).toBe(1000);
  });

  it("returns an empty array for malformed payloads", () => {
    expect(parseRatingChangesPayload("not-json")).toEqual([]);
  });
});

describe("formatRatingDelta", () => {
  it("formats positive and negative deltas", () => {
    expect(formatRatingDelta(42)).toBe("+42");
    expect(formatRatingDelta(-18)).toBe("-18");
  });

  it("rounds deltas when requested", () => {
    expect(formatRatingDelta(12.6, { round: true })).toBe("+13");
    expect(formatRatingDelta(-12.4, { round: true })).toBe("-12");
  });

  it("omits plus sign for zero when configured", () => {
    expect(formatRatingDelta(0, { includeZeroSign: false })).toBe("0");
  });

  it("handles non-finite deltas", () => {
    expect(formatRatingDelta(Number.NaN)).toBe("0");
  });
});
