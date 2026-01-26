import type { ProblemService } from "../../src/services/problems.js";
import type { ContestSolvesResult, StoreService } from "../../src/services/store.js";
import {
  getContestSolvesDataMessage,
  loadContestSolvesData,
  resolveContestSolvesContext,
  resolveContestSolvesOptions,
  shouldShowContestSolvesStale,
} from "../../src/utils/contestSolvesData.js";

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

describe("getContestSolvesDataMessage", () => {
  it("returns messages for missing contest data", () => {
    expect(getContestSolvesDataMessage({ status: "no_problems" })).toBe(
      "No contest problems found in the cache yet."
    );
    expect(getContestSolvesDataMessage({ status: "no_solves" })).toBe(
      "Contest submissions cache not ready yet. Try again soon."
    );
  });

  it("returns null for ok results", () => {
    const contestSolves = {
      solves: [],
      source: "cache",
      isStale: false,
    } satisfies ContestSolvesResult;
    expect(
      getContestSolvesDataMessage({
        status: "ok",
        contestProblems: [],
        contestSolves,
      })
    ).toBeNull();
  });
});

describe("shouldShowContestSolvesStale", () => {
  it("returns true when refresh or contest data is stale", () => {
    const contestSolves = {
      solves: [],
      source: "cache",
      isStale: true,
    } satisfies ContestSolvesResult;

    expect(shouldShowContestSolvesStale(false, contestSolves)).toBe(true);
    expect(
      shouldShowContestSolvesStale(true, { ...contestSolves, isStale: false })
    ).toBe(true);
  });

  it("returns false when both refresh and contest data are fresh", () => {
    const contestSolves = {
      solves: [],
      source: "cache",
      isStale: false,
    } satisfies ContestSolvesResult;

    expect(shouldShowContestSolvesStale(false, contestSolves)).toBe(false);
  });
});

describe("resolveContestSolvesContext", () => {
  const contest = {
    id: 1234,
    name: "Codeforces Round #1234",
    phase: "FINISHED",
    startTimeSeconds: 1_700_000_000,
    durationSeconds: 7200,
  };

  const createInteraction = () =>
    ({
      editReply: jest.fn().mockResolvedValue(undefined),
    }) as unknown as import("discord.js").ChatInputCommandInteraction;

  it("returns contest data after refresh and lookup", async () => {
    const interaction = createInteraction();
    const contests = {
      refresh: jest.fn().mockResolvedValue(undefined),
      getLastRefreshAt: jest.fn().mockReturnValue(1),
      getLatestFinished: jest.fn().mockReturnValue(contest),
      getContestById: jest.fn().mockReturnValue(contest),
      searchContests: jest.fn().mockReturnValue([contest]),
    };

    const result = await resolveContestSolvesContext({
      interaction,
      queryRaw: "1234",
      scope: "official",
      contests,
      footerText: "Footer",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.contest.id).toBe(1234);
      expect(result.refreshWasStale).toBe(false);
    }
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it("replies when contest refresh fails without cache", async () => {
    const interaction = createInteraction();
    const contests = {
      refresh: jest.fn().mockRejectedValue(new Error("CF down")),
      getLastRefreshAt: jest.fn().mockReturnValue(0),
      getLatestFinished: jest.fn(),
      getContestById: jest.fn(),
      searchContests: jest.fn(),
    };

    const result = await resolveContestSolvesContext({
      interaction,
      queryRaw: "1234",
      scope: "official",
      contests,
      footerText: "Footer",
    });

    expect(result.status).toBe("replied");
    expect(interaction.editReply).toHaveBeenCalledWith(
      "Unable to reach Codeforces right now. Try again in a few minutes."
    );
  });

  it("replies when contest lookup finds no matches", async () => {
    const interaction = createInteraction();
    const contests = {
      refresh: jest.fn().mockResolvedValue(undefined),
      getLastRefreshAt: jest.fn().mockReturnValue(1),
      getLatestFinished: jest.fn().mockReturnValue(null),
      getContestById: jest.fn().mockReturnValue(null),
      searchContests: jest.fn().mockReturnValue([]),
    };

    const result = await resolveContestSolvesContext({
      interaction,
      queryRaw: "mystery contest",
      scope: "official",
      contests,
      footerText: "Footer",
    });

    expect(result.status).toBe("replied");
    expect(interaction.editReply).toHaveBeenCalledWith(
      "No contests found matching that name."
    );
  });
});

describe("resolveContestSolvesOptions", () => {
  const createInteraction = (options: {
    query?: string;
    scope?: string | null;
    limit?: number | null;
  }) =>
    ({
      options: {
        getString: (name: string, required?: boolean) => {
          if (name === "query") {
            if (options.query === undefined && required) {
              throw new Error("query required");
            }
            return options.query ?? null;
          }
          if (name === "scope") {
            return options.scope ?? null;
          }
          return null;
        },
        getInteger: (name: string) => {
          if (name === "limit") {
            return options.limit ?? null;
          }
          return null;
        },
      },
    }) as unknown as import("discord.js").ChatInputCommandInteraction;

  it("returns an error when limit is invalid", () => {
    const interaction = createInteraction({
      query: "1234",
      scope: "official",
      limit: 99,
    });

    const result = resolveContestSolvesOptions(interaction, {
      defaultLimit: 10,
      maxLimit: 25,
    });

    expect(result).toEqual({ status: "error", message: "Invalid limit." });
  });

  it("returns parsed options when inputs are valid", () => {
    const interaction = createInteraction({
      query: "  1234  ",
      scope: "gym",
      limit: null,
    });

    const result = resolveContestSolvesOptions(interaction, {
      defaultLimit: 10,
      maxLimit: 25,
    });

    expect(result).toEqual({
      status: "ok",
      queryRaw: "1234",
      scope: "gym",
      limit: 10,
    });
  });
});
