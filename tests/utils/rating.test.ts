import { getRatingChanges } from "../../src/utils/rating.js";

function legacyRatingChanges(
  oldRating: number,
  problemRating: number,
  length: number
): [number, number] {
  const adjusted = problemRating + 50 * ((80 - length) / 20);
  const magnitude = 16;
  const expected = 1 / (1 + 10 ** ((adjusted - oldRating) / 500));
  const down = -Math.min(magnitude * 10, Math.floor((0.5 * magnitude) / (1 - expected)));
  const up = Math.min(magnitude * 10, Math.floor((0.5 * magnitude) / (1.15 * expected)));
  return [down, up];
}

describe("getRatingChanges", () => {
  it("matches the legacy rating change formula across representative inputs", () => {
    const cases: Array<[number, number, number]> = [
      [1500, 1500, 60],
      [1500, 800, 40],
      [1500, 2000, 80],
      [2100, 1800, 90],
      [2100, 2200, 30],
      [1200, 1100, 120],
      [1800, 2600, 60],
      [2400, 2000, 75],
      [1000, 1400, 20],
      [1900, 1900, 50],
    ];

    for (const [oldRating, problemRating, length] of cases) {
      expect(getRatingChanges(oldRating, problemRating, length)).toEqual(
        legacyRatingChanges(oldRating, problemRating, length)
      );
    }
  });
});
