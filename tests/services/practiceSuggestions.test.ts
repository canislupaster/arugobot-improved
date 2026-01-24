import { PracticeSuggestionService } from "../../src/services/practiceSuggestions.js";
import type { ProblemService } from "../../src/services/problems.js";
import type { StoreService } from "../../src/services/store.js";

describe("PracticeSuggestionService", () => {
  it("returns no_problems when the problem cache is empty", async () => {
    const problems = {
      ensureProblemsLoaded: jest.fn().mockResolvedValue([]),
    } as unknown as ProblemService;
    const store = {
      getSolvedProblemsResult: jest.fn(),
    } as unknown as StoreService;

    const service = new PracticeSuggestionService(problems, store);
    const result = await service.suggestProblem("tourist", {
      ratingRanges: [{ min: 800, max: 1200 }],
      tags: "",
    });

    expect(result).toEqual({ status: "no_problems", handle: "tourist" });
  });

  it("returns no_solved when solved data is unavailable", async () => {
    const problems = {
      ensureProblemsLoaded: jest
        .fn()
        .mockResolvedValue([{ contestId: 1, index: "A", name: "Test", rating: 800, tags: [] }]),
    } as unknown as ProblemService;
    const store = {
      getSolvedProblemsResult: jest.fn().mockResolvedValue(null),
    } as unknown as StoreService;

    const service = new PracticeSuggestionService(problems, store);
    const result = await service.suggestProblem("tourist", {
      ratingRanges: [{ min: 800, max: 1200 }],
      tags: "",
    });

    expect(result).toEqual({ status: "no_solved", handle: "tourist" });
  });

  it("returns a suggestion when a candidate remains", async () => {
    const problems = {
      ensureProblemsLoaded: jest.fn().mockResolvedValue([
        { contestId: 1, index: "A", name: "Keep Out", rating: 800, tags: [] },
        { contestId: 1, index: "B", name: "Pick Me", rating: 900, tags: [] },
      ]),
    } as unknown as ProblemService;
    const store = {
      getSolvedProblemsResult: jest.fn().mockResolvedValue({
        solved: ["1A"],
        source: "api",
        isStale: false,
      }),
    } as unknown as StoreService;

    const service = new PracticeSuggestionService(problems, store);
    const result = await service.suggestProblem("tourist", {
      ratingRanges: [{ min: 800, max: 1000 }],
      tags: "",
      excludedIds: new Set(["2C"]),
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.problem.index).toBe("B");
      expect(result.excludedCount).toBe(2);
      expect(result.solvedCount).toBe(1);
    }
  });
});
