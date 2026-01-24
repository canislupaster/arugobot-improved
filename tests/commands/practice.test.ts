import type { ChatInputCommandInteraction } from "discord.js";

import { practiceCommand } from "../../src/commands/practice.js";
import type { CommandContext } from "../../src/types/commandContext.js";
import { publicFlags } from "../../src/utils/discordFlags.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    options: {
      getString: jest.fn((name: string) => {
        if (name === "handle") return "";
        if (name === "tags") return "";
        return null;
      }),
      getUser: jest.fn().mockReturnValue(null),
      getInteger: jest.fn().mockReturnValue(null),
    },
    user: { id: "user-1", username: "Tester" },
    guild: { id: "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("practiceCommand", () => {
  it("rejects providing both user and handle", async () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn((name: string) => (name === "handle" ? "tourist" : null)),
        getUser: jest.fn().mockReturnValue({ id: "user-2" }),
        getInteger: jest.fn().mockReturnValue(null),
      },
    });
    const context = {} as CommandContext;

    await practiceCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Provide either a handle or a user, not both.",
      ...publicFlags,
    });
  });

  it("suggests a problem for a linked user", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-1",
      services: {
        store: {
          resolveHandle: jest.fn(),
          getHandle: jest.fn().mockResolvedValue("tourist"),
          getPracticePreferences: jest.fn().mockResolvedValue(null),
          getHistoryList: jest.fn().mockResolvedValue([]),
          cleanupPracticeSuggestions: jest.fn().mockResolvedValue(undefined),
          getRecentPracticeSuggestions: jest.fn().mockResolvedValue([]),
          recordPracticeSuggestion: jest.fn().mockResolvedValue(undefined),
          getUserIdByHandle: jest.fn(),
        },
        practiceSuggestions: {
          suggestProblem: jest.fn().mockResolvedValue({
            status: "ok",
            handle: "tourist",
            problem: {
              contestId: 1000,
              index: "A",
              name: "Test",
              rating: 800,
              tags: [],
            },
            candidateCount: 12,
            excludedCount: 3,
            solvedCount: 50,
            isStale: false,
            source: "api",
          }),
        },
      },
    } as unknown as CommandContext;

    await practiceCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ...publicFlags });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.any(Object)],
      })
    );
  });

  it("uses saved preferences when no filters are provided", async () => {
    const interaction = createInteraction();
    const preferences = {
      ratingRanges: [{ min: 1200, max: 1600 }],
      tags: "dp, greedy",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const suggestProblem = jest.fn().mockResolvedValue({
      status: "ok",
      handle: "tourist",
      problem: {
        contestId: 1200,
        index: "A",
        name: "Pref Problem",
        rating: 1300,
        tags: ["dp"],
      },
      candidateCount: 12,
      excludedCount: 3,
      solvedCount: 50,
      isStale: false,
      source: "api",
    });
    const context = {
      correlationId: "corr-2",
      services: {
        store: {
          resolveHandle: jest.fn(),
          getHandle: jest.fn().mockResolvedValue("tourist"),
          getPracticePreferences: jest.fn().mockResolvedValue(preferences),
          getHistoryList: jest.fn().mockResolvedValue([]),
          cleanupPracticeSuggestions: jest.fn().mockResolvedValue(undefined),
          getRecentPracticeSuggestions: jest.fn().mockResolvedValue([]),
          recordPracticeSuggestion: jest.fn().mockResolvedValue(undefined),
          getUserIdByHandle: jest.fn(),
        },
        practiceSuggestions: {
          suggestProblem,
        },
      },
    } as unknown as CommandContext;

    await practiceCommand.execute(interaction, context);

    expect(suggestProblem).toHaveBeenCalledWith("tourist", {
      ratingRanges: preferences.ratingRanges,
      tags: preferences.tags,
      excludedIds: expect.any(Set),
    });
  });
});
