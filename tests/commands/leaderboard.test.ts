import type { ChatInputCommandInteraction } from "discord.js";

import { leaderboardCommand } from "../../src/commands/leaderboard.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) => {
  const getIntegerOverride = overrides.getInteger as ((name: string) => number | null) | undefined;
  const getStringOverride = overrides.getString as ((name: string) => string | null) | undefined;
  const response = {
    createMessageComponentCollector: jest.fn().mockReturnValue({ on: jest.fn() }),
  };
  return {
    options: {
      getInteger: jest.fn((name: string) => {
        if (getIntegerOverride) {
          return getIntegerOverride(name);
        }
        if (name === "page") {
          return 1;
        }
        return null;
      }),
      getString: jest.fn((name: string) => {
        if (getStringOverride) {
          return getStringOverride(name);
        }
        if (name === "metric") {
          return "solves";
        }
        return null;
      }),
    },
    user: { id: "user-1" },
    guild: {
      id: "guild-1",
      members: {
        fetch: jest.fn().mockResolvedValue(
          new Map([
            ["user-1", { user: { id: "user-1" }, toString: () => "<@user-1>" }],
            ["user-2", { user: { id: "user-2" }, toString: () => "<@user-2>" }],
          ])
        ),
        cache: new Map([
          ["user-1", { user: { id: "user-1" }, toString: () => "<@user-1>" }],
          ["user-2", { user: { id: "user-2" }, toString: () => "<@user-2>" }],
        ]),
      },
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(response),
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
};

describe("leaderboardCommand", () => {
  it("renders the solve leaderboard when requested", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        store: {
          getSolveLeaderboard: jest.fn().mockResolvedValue([
            { userId: "user-1", solvedCount: 2 },
            { userId: "user-2", solvedCount: 1 },
          ]),
        },
      },
    } as unknown as CommandContext;

    await leaderboardCommand.execute(interaction, context);

    expect(context.services.store.getSolveLeaderboard).toHaveBeenCalledWith("guild-1");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Solve leaderboard");
  });

  it("renders the current streak leaderboard", async () => {
    const interaction = createInteraction({
      options: {
        getInteger: jest.fn().mockReturnValue(1),
        getString: jest.fn().mockReturnValue("streak"),
      },
    });
    const context = {
      services: {
        store: {
          getStreakLeaderboard: jest.fn().mockResolvedValue([
            {
              userId: "user-1",
              currentStreak: 3,
              longestStreak: 5,
              totalSolvedDays: 10,
              lastSolvedAt: new Date().toISOString(),
            },
          ]),
        },
      },
    } as unknown as CommandContext;

    await leaderboardCommand.execute(interaction, context);

    expect(context.services.store.getStreakLeaderboard).toHaveBeenCalledWith("guild-1");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Current streak leaderboard");
    const fieldValue = payload.embeds[0].data.fields?.[0]?.value ?? "";
    expect(fieldValue).toContain("🔥");
  });

  it("renders the contest leaderboard when requested", async () => {
    const interaction = createInteraction({
      getInteger: (name: string) => {
        if (name === "page") {
          return 1;
        }
        if (name === "days") {
          return 30;
        }
        return null;
      },
      getString: (name: string) => (name === "metric" ? "contests" : null),
    });
    const context = {
      services: {
        store: {
          getServerRoster: jest.fn().mockResolvedValue([
            { userId: "user-1", handle: "alice" },
            { userId: "user-2", handle: "bob" },
          ]),
        },
        contestActivity: {
          getContestActivityForRoster: jest.fn().mockResolvedValue({
            lookbackDays: 30,
            contestCount: 2,
            participantCount: 2,
            topContests: [],
            recentContests: [],
            byScope: {
              official: { contestCount: 2, participantCount: 2, lastContestAt: null },
              gym: { contestCount: 0, participantCount: 0, lastContestAt: null },
            },
            participants: [
              {
                userId: "user-1",
                handle: "alice",
                contestCount: 2,
                officialCount: 2,
                gymCount: 0,
                lastContestAt: null,
              },
            ],
          }),
        },
      },
    } as unknown as CommandContext;

    await leaderboardCommand.execute(interaction, context);

    expect(context.services.store.getServerRoster).toHaveBeenCalledWith("guild-1");
    expect(context.services.contestActivity.getContestActivityForRoster).toHaveBeenCalled();
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Contest leaderboard (30d)");
  });

  it("reports when no handles are linked for contest leaderboard", async () => {
    const interaction = createInteraction({
      getInteger: (name: string) => (name === "page" ? 1 : null),
      getString: (name: string) => (name === "metric" ? "contests" : null),
    });
    const context = {
      services: {
        store: {
          getServerRoster: jest.fn().mockResolvedValue([]),
        },
      },
    } as unknown as CommandContext;

    await leaderboardCommand.execute(interaction, context);

    expect(context.services.store.getServerRoster).toHaveBeenCalledWith("guild-1");
    expect(interaction.editReply).toHaveBeenCalledWith(
      "No linked handles yet. Use /register to link a Codeforces handle."
    );
  });
});
