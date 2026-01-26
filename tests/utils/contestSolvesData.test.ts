import {
  formatContestSolvesSummary,
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
