import type { Problem } from "../../src/services/problems.js";
import {
  filterProblemsByRatingRange,
  filterProblemsByRatingRanges,
  filterProblemsByTags,
  getProblemId,
  parseTagFilters,
  selectRandomProblem,
  selectRandomProblems,
} from "../../src/utils/problemSelection.js";

const problems: Problem[] = [
  { contestId: 1, index: "A", name: "A", rating: 800, tags: ["dp", "math"] },
  { contestId: 1, index: "B", name: "B", rating: 1200, tags: ["greedy"] },
  { contestId: 1, index: "C", name: "C", tags: ["math"] },
  { contestId: 2, index: "A", name: "D", rating: 1500, tags: ["dp", "graphs"] },
];

describe("problemSelection", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("filters problems by rating range", () => {
    const filtered = filterProblemsByRatingRange(problems, 1000, 1400);
    expect(filtered.map(getProblemId)).toEqual(["1B"]);
  });

  it("filters problems by multiple rating ranges", () => {
    const filtered = filterProblemsByRatingRanges(problems, [
      { min: 700, max: 900 },
      { min: 1400, max: 1600 },
    ]);
    expect(filtered.map(getProblemId)).toEqual(["1A", "2A"]);
  });

  it("selects random problems excluding solved ids", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const excluded = new Set<string>(["1A", "1B"]);
    const selected = selectRandomProblems(problems, excluded, 2);
    expect(selected).toHaveLength(2);
    expect(selected.map(getProblemId)).toEqual(["2A", "1C"]);
  });

  it("parses include and exclude tag filters", () => {
    const filters = parseTagFilters("dp, greedy -math");
    expect(filters).toEqual({ include: ["dp", "greedy"], exclude: ["math"] });
  });

  it("filters problems by tag filters", () => {
    const filters = { include: ["dp"], exclude: ["math"] };
    const filtered = filterProblemsByTags(problems, filters);
    expect(filtered.map(getProblemId)).toEqual(["2A"]);
  });

  it("returns null when no problems remain", () => {
    const excluded = new Set<string>(problems.map(getProblemId));
    const result = selectRandomProblem(problems, excluded);
    expect(result).toBeNull();
  });
});
