import type { ProblemService } from "../../src/services/problems.js";
import type { ContestSolvesResult, StoreService } from "../../src/services/store.js";
import { loadContestSolvesData } from "../../src/utils/contestSolvesData.js";

describe("loadContestSolvesData", () => {
  it("returns no_problems when contest has no cached problems", async () => {
    const problems = {
      ensureProblemsLoaded: jest.fn().mockResolvedValue([
        { contestId: 1, index: "A", name: "Alpha", tags: [] },
      ]),
    } satisfies Pick<ProblemService, "ensureProblemsLoaded">;
    const store = {
      getContestSolvesResult: jest.fn().mockResolvedValue({
        solves: [],
        source: "cache",
        isStale: false,
      } satisfies ContestSolvesResult),
    } satisfies Pick<StoreService, "getContestSolvesResult">;

    const result = await loadContestSolvesData(problems, store, 999);

    expect(result).toEqual({ status: "no_problems" });
    expect(store.getContestSolvesResult).not.toHaveBeenCalled();
  });

  it("returns no_solves when submissions cache is unavailable", async () => {
    const problems = {
      ensureProblemsLoaded: jest.fn().mockResolvedValue([
        { contestId: 5, index: "A", name: "Alpha", tags: [] },
      ]),
    } satisfies Pick<ProblemService, "ensureProblemsLoaded">;
    const store = {
      getContestSolvesResult: jest.fn().mockResolvedValue(null),
    } satisfies Pick<StoreService, "getContestSolvesResult">;

    const result = await loadContestSolvesData(problems, store, 5);

    expect(result).toEqual({ status: "no_solves" });
    expect(store.getContestSolvesResult).toHaveBeenCalledWith(5);
  });

  it("returns contest problems and solves when available", async () => {
    const problems = {
      ensureProblemsLoaded: jest.fn().mockResolvedValue([
        { contestId: 3, index: "A", name: "Alpha", tags: [] },
        { contestId: 4, index: "B", name: "Beta", tags: [] },
      ]),
    } satisfies Pick<ProblemService, "ensureProblemsLoaded">;
    const contestSolves = {
      solves: [
        { id: 1, handle: "tourist", contestId: 3, index: "A", creationTimeSeconds: 1 },
      ],
      source: "cache",
      isStale: false,
    } satisfies ContestSolvesResult;
    const store = {
      getContestSolvesResult: jest.fn().mockResolvedValue(contestSolves),
    } satisfies Pick<StoreService, "getContestSolvesResult">;

    const result = await loadContestSolvesData(problems, store, 3);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.contestProblems).toHaveLength(1);
      expect(result.contestProblems[0].contestId).toBe(3);
      expect(result.contestSolves).toBe(contestSolves);
    }
  });
});
