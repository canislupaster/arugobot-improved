import { buildProblemUrl, parseProblemReference } from "../../src/utils/problemReference.js";

describe("parseProblemReference", () => {
  it("parses raw ids", () => {
    expect(parseProblemReference("1000A")).toEqual({
      contestId: 1000,
      index: "A",
      id: "1000A",
    });
    expect(parseProblemReference("  1000a ")).toEqual({
      contestId: 1000,
      index: "A",
      id: "1000A",
    });
    expect(parseProblemReference("1000 A")).toEqual({
      contestId: 1000,
      index: "A",
      id: "1000A",
    });
  });

  it("parses Codeforces URLs", () => {
    expect(parseProblemReference("https://codeforces.com/contest/1000/problem/B")).toEqual({
      contestId: 1000,
      index: "B",
      id: "1000B",
    });
    expect(parseProblemReference("https://codeforces.com/problemset/problem/1000/C")).toEqual({
      contestId: 1000,
      index: "C",
      id: "1000C",
    });
    expect(
      parseProblemReference("https://codeforces.com/problemset/contest/1000/problem/D")
    ).toEqual({
      contestId: 1000,
      index: "D",
      id: "1000D",
    });
    expect(parseProblemReference("https://codeforces.com/gym/500/problem/A")).toEqual({
      contestId: 500,
      index: "A",
      id: "500A",
    });
  });

  it("rejects invalid input", () => {
    expect(parseProblemReference("")).toBeNull();
    expect(parseProblemReference("invalid")).toBeNull();
    expect(parseProblemReference("1000")).toBeNull();
  });
});

describe("buildProblemUrl", () => {
  it("builds Codeforces problem links", () => {
    expect(buildProblemUrl(1000, "A")).toBe("https://codeforces.com/problemset/problem/1000/A");
  });
});
