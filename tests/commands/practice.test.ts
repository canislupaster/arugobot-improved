import type { ChatInputCommandInteraction } from "discord.js";

import { practiceCommand } from "../../src/commands/practice.js";
import type { CommandContext } from "../../src/types/commandContext.js";

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
      ephemeral: true,
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
          getHistoryList: jest.fn().mockResolvedValue([]),
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

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.any(Object)],
      })
    );
  });
});
