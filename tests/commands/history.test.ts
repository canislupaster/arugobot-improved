import type { ChatInputCommandInteraction } from "discord.js";

import { historyCommand } from "../../src/commands/history.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) => {
  const response = {
    createMessageComponentCollector: jest.fn().mockReturnValue({ on: jest.fn() }),
  };
  return {
    commandName: "history",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getInteger: jest.fn().mockReturnValue(1),
      getUser: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(response),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
};

describe("historyCommand", () => {
  it("renders completed challenge history when available", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-1",
      services: {
        store: {
          getChallengeHistoryPage: jest.fn().mockResolvedValue({
            total: 1,
            entries: [
              {
                challengeId: "challenge-1",
                problemId: "1000A",
                contestId: 1000,
                index: "A",
                name: "Test Problem",
                rating: 1200,
                startedAt: 1000,
                endsAt: 2000,
                solvedAt: 1500,
                ratingDelta: 25,
              },
            ],
          }),
        },
      },
    } as unknown as CommandContext;

    await historyCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalled();
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds).toBeDefined();
    expect(payload.components).toHaveLength(0);
  });

  it("falls back to legacy history when no completed challenges exist", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-2",
      services: {
        store: {
          getChallengeHistoryPage: jest.fn().mockResolvedValue({ total: 0, entries: [] }),
          getHistoryWithRatings: jest.fn().mockResolvedValue({
            history: ["1000A"],
            ratingHistory: [1500, 1520],
          }),
        },
        problems: {
          getProblemDict: jest
            .fn()
            .mockReturnValue(
              new Map([
                [
                  "1000A",
                  { contestId: 1000, index: "A", name: "Legacy Problem", rating: 1200, tags: [] },
                ],
              ])
            ),
        },
      },
    } as unknown as CommandContext;

    await historyCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalled();
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds).toBeDefined();
    expect(payload.components).toHaveLength(0);
  });

  it("uses the selected user when provided", async () => {
    const interaction = createInteraction({
      options: {
        getInteger: jest.fn().mockReturnValue(1),
        getUser: jest.fn().mockReturnValue({ id: "user-2" }),
      },
    });
    const getChallengeHistoryPage = jest.fn().mockResolvedValue({
      total: 1,
      entries: [
        {
          challengeId: "challenge-1",
          problemId: "1000A",
          contestId: 1000,
          index: "A",
          name: "Test Problem",
          rating: 1200,
          startedAt: 1000,
          endsAt: 2000,
          solvedAt: 1500,
          ratingDelta: 25,
        },
      ],
    });
    const context = {
      correlationId: "corr-3",
      services: {
        store: {
          getChallengeHistoryPage,
        },
      },
    } as unknown as CommandContext;

    await historyCommand.execute(interaction, context);

    expect(getChallengeHistoryPage).toHaveBeenCalledWith("guild-1", "user-2", 1, 10);
  });
});
