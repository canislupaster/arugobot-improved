import { splitContestSolves, type ContestSolveEntry } from "../../src/utils/contestProblems.js";

import type { Problem } from "../../src/services/problems.js";

describe("splitContestSolves", () => {
  it("splits solved and unsolved problems using normalized handles", () => {
    const problems: Problem[] = [
      { contestId: 1, index: "A", name: "Alpha", tags: [] },
      { contestId: 1, index: "B", name: "Beta", tags: [] },
    ];
    const solves: ContestSolveEntry[] = [
      { handle: "tourist", contestId: 1, index: "A" },
    ];
    const handleMap = new Map([["Tourist", "Tourist"]]);

    const result = splitContestSolves(problems, solves, handleMap);

    expect(result.summaries).toHaveLength(2);
    expect(result.solved).toHaveLength(1);
    expect(result.unsolved).toHaveLength(1);
    expect(Array.from(result.solved[0].solvedBy)).toEqual(["Tourist"]);
    expect(result.unsolved[0].problem.index).toBe("B");
  });
});
