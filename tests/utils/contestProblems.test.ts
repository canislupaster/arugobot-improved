import type { Problem } from "../../src/services/problems.js";
import {
  formatContestProblemLines,
  formatUnsolvedProblemsValue,
  splitContestSolves,
  type ContestSolveEntry,
} from "../../src/utils/contestProblems.js";

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

describe("formatContestProblemLines", () => {
  it("formats a limited list with solved counts when provided", () => {
    const entries = [
      {
        problem: { contestId: 1, index: "A", name: "Alpha", tags: [] },
        solvedBy: new Set(["tourist", "neal"]),
      },
      {
        problem: { contestId: 1, index: "B", name: "Beta", tags: [] },
        solvedBy: new Set(["neal"]),
      },
    ];

    const lines = formatContestProblemLines(entries, 1, (entry) => entry.solvedBy.size, {
      isGym: true,
    });

    expect(lines).toContain("Alpha");
    expect(lines).toContain("2 solved");
    expect(lines).toContain("https://codeforces.com/gym/1/problem/A");
    expect(lines).not.toContain("Beta");
  });
});

describe("formatUnsolvedProblemsValue", () => {
  it("returns the empty message when there are no unsolved problems", () => {
    const value = formatUnsolvedProblemsValue([], 10, "All solved.");

    expect(value).toBe("All solved.");
  });

  it("formats the unsolved list when entries exist", () => {
    const entries = [
      {
        problem: { contestId: 1, index: "A", name: "Alpha", tags: [] },
        solvedBy: new Set<string>(),
      },
      {
        problem: { contestId: 1, index: "B", name: "Beta", tags: [] },
        solvedBy: new Set<string>(),
      },
    ];

    const value = formatUnsolvedProblemsValue(entries, 1, "All solved.");

    expect(value).toContain("Alpha");
    expect(value).not.toContain("Beta");
  });
});
