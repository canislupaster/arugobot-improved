import type { ContestSolvesResult } from "../../src/services/store.js";
import { getContestSolvesStaleFooter } from "../../src/utils/contestSolvesData.js";

describe("getContestSolvesStaleFooter", () => {
  const baseSolves: ContestSolvesResult = { solves: [], source: "api", isStale: false };

  it("returns null when data is fresh", () => {
    expect(getContestSolvesStaleFooter(false, baseSolves)).toBeNull();
  });

  it("returns a footer when refresh is stale", () => {
    expect(getContestSolvesStaleFooter(true, baseSolves)).toBe(
      "Showing cached data due to a temporary Codeforces error."
    );
  });

  it("returns a footer when cache is stale", () => {
    expect(getContestSolvesStaleFooter(false, { ...baseSolves, isStale: true })).toBe(
      "Showing cached data due to a temporary Codeforces error."
    );
  });
});
