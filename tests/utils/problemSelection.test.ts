import type { Problem } from "../../src/services/problems.js";
import {
  filterProblemsByRatingRange,
  getProblemId,
  selectRandomProblem,
  selectRandomProblems,
} from "../../src/utils/problemSelection.js";

const problems: Problem[] = [
  { contestId: 1, index: "A", name: "A", rating: 800, tags: [] },
  { contestId: 1, index: "B", name: "B", rating: 1200, tags: [] },
  { contestId: 1, index: "C", name: "C", tags: [] },
  { contestId: 2, index: "A", name: "D", rating: 1500, tags: [] },
];

describe("problemSelection", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("filters problems by rating range", () => {
    const filtered = filterProblemsByRatingRange(problems, 1000, 1400);
    expect(filtered.map(getProblemId)).toEqual(["1B"]);
  });

  it("selects random problems excluding solved ids", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const excluded = new Set<string>(["1A", "1B"]);
    const selected = selectRandomProblems(problems, excluded, 2);
    expect(selected).toHaveLength(2);
    expect(selected.map(getProblemId)).toEqual(["2A", "1C"]);
  });

  it("returns null when no problems remain", () => {
    const excluded = new Set<string>(problems.map(getProblemId));
    const result = selectRandomProblem(problems, excluded);
    expect(result).toBeNull();
  });
});
