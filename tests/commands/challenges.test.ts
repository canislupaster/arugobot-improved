import type { ChatInputCommandInteraction } from "discord.js";

import { challengesCommand } from "../../src/commands/challenges.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "challenges",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getSubcommand: jest.fn(),
      getInteger: jest.fn(),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("challengesCommand", () => {
  it("lists active challenges", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("list"),
        getInteger: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-1",
      services: {
        challenges: {
          listActiveChallenges: jest.fn().mockResolvedValue([
            {
              id: "challenge-1",
              serverId: "guild-1",
              channelId: "channel-1",
              messageId: "message-1",
              hostUserId: "user-1",
              problem: { contestId: 1000, index: "A", name: "Test", rating: 1200 },
              lengthMinutes: 40,
              startedAt: 1000,
              endsAt: 2000,
              status: "active",
              checkIndex: 0,
              participants: [],
            },
          ]),
        },
      },
    } as unknown as CommandContext;

    await challengesCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it("shows the caller's active challenges", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("mine"),
        getInteger: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-2",
      services: {
        challenges: {
          listActiveChallengesForUser: jest.fn().mockResolvedValue([
            {
              id: "challenge-2",
              serverId: "guild-1",
              channelId: "channel-2",
              messageId: "message-2",
              hostUserId: "user-1",
              problem: { contestId: 1200, index: "B", name: "Test 2", rating: 1300 },
              lengthMinutes: 60,
              startedAt: 1000,
              endsAt: 2000,
              status: "active",
              checkIndex: 0,
              participants: [],
            },
          ]),
        },
      },
    } as unknown as CommandContext;

    await challengesCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it("returns a message when there are no active challenges to cancel", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("cancel"),
        getInteger: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-3",
      services: {
        challenges: {
          listActiveChallenges: jest.fn().mockResolvedValue([]),
        },
      },
    } as unknown as CommandContext;

    await challengesCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No active challenges to cancel.",
    });
  });

  it("shows recent completed challenges", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("recent"),
        getInteger: jest.fn().mockReturnValue(2),
      },
    });
    const context = {
      correlationId: "corr-4",
      services: {
        challenges: {
          listRecentCompletedChallenges: jest.fn().mockResolvedValue([
            {
              id: "challenge-3",
              serverId: "guild-1",
              channelId: "channel-3",
              hostUserId: "user-2",
              problem: { contestId: 1234, index: "A", name: "Test 3", rating: 900 },
              startedAt: 1000,
              endsAt: 2000,
              completedAt: 1500,
              participants: [
                { userId: "user-2", solvedAt: 1200, ratingDelta: 20 },
                { userId: "user-1", solvedAt: null, ratingDelta: -10 },
              ],
            },
          ]),
        },
      },
    } as unknown as CommandContext;

    await challengesCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });
});
