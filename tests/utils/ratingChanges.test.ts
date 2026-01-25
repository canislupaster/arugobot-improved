import { parseRatingChangesPayload } from "../../src/utils/ratingChanges.js";

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
