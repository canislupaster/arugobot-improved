import type { ChatInputCommandInteraction } from "discord.js";

import { historyCommand } from "../../src/commands/history.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "history",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getInteger: jest.fn().mockReturnValue(1),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

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
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
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
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });
});
