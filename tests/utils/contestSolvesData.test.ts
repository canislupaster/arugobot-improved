import type { ContestSolvesResult } from "../../src/services/store.js";
import {
  applyContestSolvesStaleFooter,
  buildContestSolvesSummaryFields,
  formatContestSolvesSummary,
  getContestSolvesStaleFooter,
  resolveContestSolvesCommandOptionsOrReply,
  resolveContestSolvesOptionsOrReply,
} from "../../src/utils/contestSolvesData.js";

describe("formatContestSolvesSummary", () => {
  it("includes handle count when provided", () => {
    const summary = formatContestSolvesSummary({
      totalProblems: 12,
      solvedCount: 5,
      unsolvedCount: 7,
      handleCount: 3,
    });

    expect(summary).toContain("Handles included: 3");
    expect(summary).toContain("Solved problems: 5/12");
    expect(summary).toContain("Unsolved problems: 7");
  });

  it("omits handle count when not provided", () => {
    const summary = formatContestSolvesSummary({
      totalProblems: 4,
      solvedCount: 1,
      unsolvedCount: 3,
    });

    expect(summary).toBe(["Solved problems: 1/4", "Unsolved problems: 3"].join("\n"));
  });
});

describe("resolveContestSolvesOptionsOrReply", () => {
  type FakeInteraction = {
    options: {
      getString: jest.Mock<string | null, [string]>;
      getInteger: jest.Mock<number | null, [string]>;
    };
    reply: jest.Mock<Promise<void>, [{ content: string }]>;
  };

  const createInteraction = (overrides: Record<string, unknown> = {}) =>
    ({
      options: {
        getString: jest.fn((name: string) => (name === "query" ? " 123 " : null)),
        getInteger: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    }) as FakeInteraction;

  it("returns resolved options without replying", async () => {
    const interaction = createInteraction();

    const result = await resolveContestSolvesOptionsOrReply(
      interaction as unknown as Parameters<typeof resolveContestSolvesOptionsOrReply>[0],
      {
        defaultLimit: 10,
        maxLimit: 25,
      }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.queryRaw).toBe("123");
      expect(result.limit).toBe(10);
    }
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("replies and stops on invalid limit", async () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn((name: string) => (name === "query" ? "123" : null)),
        getInteger: jest.fn().mockReturnValue(0),
      },
    });

    const result = await resolveContestSolvesOptionsOrReply(
      interaction as unknown as Parameters<typeof resolveContestSolvesOptionsOrReply>[0],
      {
        defaultLimit: 10,
        maxLimit: 25,
      }
    );

    expect(result).toEqual({ status: "replied" });
    expect(interaction.reply).toHaveBeenCalledWith({ content: "Invalid limit." });
  });
});

describe("resolveContestSolvesCommandOptionsOrReply", () => {
  type FakeInteraction = {
    options: {
      getString: jest.Mock<string | null, [string]>;
      getInteger: jest.Mock<number | null, [string]>;
      getBoolean: jest.Mock<boolean | null, [string]>;
    };
    reply: jest.Mock<Promise<void>, [{ content: string }]>;
  };

  const createInteraction = (overrides: Record<string, unknown> = {}) =>
    ({
      options: {
        getString: jest.fn((name: string) => (name === "query" ? " 123 " : null)),
        getInteger: jest.fn().mockReturnValue(null),
        getBoolean: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    }) as FakeInteraction;

  it("returns false when force_refresh is unset", async () => {
    const interaction = createInteraction();

    const result = await resolveContestSolvesCommandOptionsOrReply(
      interaction as unknown as Parameters<typeof resolveContestSolvesCommandOptionsOrReply>[0],
      {
        defaultLimit: 10,
        maxLimit: 25,
      }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.forceRefresh).toBe(false);
    }
  });

  it("returns true when force_refresh is set", async () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn((name: string) => (name === "query" ? "123" : null)),
        getInteger: jest.fn().mockReturnValue(null),
        getBoolean: jest.fn((name: string) => (name === "force_refresh" ? true : null)),
      },
    });

    const result = await resolveContestSolvesCommandOptionsOrReply(
      interaction as unknown as Parameters<typeof resolveContestSolvesCommandOptionsOrReply>[0],
      {
        defaultLimit: 10,
        maxLimit: 25,
      }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.forceRefresh).toBe(true);
    }
  });
});

describe("buildContestSolvesSummaryFields", () => {
  it("builds summary and unsolved fields with the empty message", () => {
    const fields = buildContestSolvesSummaryFields({
      totalProblems: 3,
      solvedCount: 3,
      unsolvedCount: 0,
      unsolved: [],
      limit: 10,
      emptyMessage: "All solved.",
    });

    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe("Summary");
    expect(fields[0].value).toContain("Solved problems: 3/3");
    expect(fields[1]).toEqual({
      name: "Unsolved problems",
      value: "All solved.",
      inline: false,
    });
  });
});

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

describe("applyContestSolvesStaleFooter", () => {
  const baseSolves: ContestSolvesResult = { solves: [], source: "api", isStale: false };

  it("returns false without setting a footer when data is fresh", () => {
    const embed = { setFooter: jest.fn() };

    const result = applyContestSolvesStaleFooter(embed, false, baseSolves);

    expect(result).toBe(false);
    expect(embed.setFooter).not.toHaveBeenCalled();
  });

  it("sets the footer and returns true when data is stale", () => {
    const embed = { setFooter: jest.fn() };

    const result = applyContestSolvesStaleFooter(embed, true, baseSolves);

    expect(result).toBe(true);
    expect(embed.setFooter).toHaveBeenCalledWith({
      text: "Showing cached data due to a temporary Codeforces error.",
    });
  });
});
