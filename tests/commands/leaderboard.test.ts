import type { ChatInputCommandInteraction } from "discord.js";

import { leaderboardCommand } from "../../src/commands/leaderboard.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    options: {
      getInteger: jest.fn().mockReturnValue(1),
      getString: jest.fn().mockReturnValue("solves"),
    },
    guild: {
      id: "guild-1",
      members: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

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
  });
});
