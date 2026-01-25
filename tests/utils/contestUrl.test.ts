import { buildContestUrl } from "../../src/utils/contestUrl.js";

describe("buildContestUrl", () => {
  it("builds official contest URLs by default", () => {
    expect(buildContestUrl({ id: 1234, isGym: false })).toBe("https://codeforces.com/contest/1234");
  });

  it("builds gym contest URLs when flagged", () => {
    expect(buildContestUrl({ id: 5678, isGym: true })).toBe("https://codeforces.com/gym/5678");
  });
});
