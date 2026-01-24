import type { ChatInputCommandInteraction } from "discord.js";

import { practiceHistoryCommand } from "../../src/commands/practiceHistory.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    options: {
      getSubcommand: jest.fn().mockReturnValue("suggestions"),
      getUser: jest.fn().mockReturnValue(null),
      getInteger: jest.fn().mockReturnValue(null),
    },
    user: { id: "user-1" },
    guild: { id: "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("practiceHistoryCommand", () => {
  it("rejects usage outside of a server", async () => {
    const interaction = createInteraction({ guild: null });
    const context = {} as CommandContext;

    await practiceHistoryCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
  });

  it("renders recent practice suggestions", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("suggestions"),
        getUser: jest.fn().mockReturnValue(null),
        getInteger: jest.fn().mockReturnValue(2),
      },
    });
    const context = {
      correlationId: "corr-1",
      services: {
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([]),
          getProblemDict: jest
            .fn()
            .mockReturnValue(
              new Map([
                ["1000A", { contestId: 1000, index: "A", name: "Example", rating: 800, tags: [] }],
              ])
            ),
        },
        store: {
          getPracticeSuggestionHistory: jest
            .fn()
            .mockResolvedValue([{ problemId: "1000A", suggestedAt: "2024-01-01T00:00:00.000Z" }]),
        },
        practiceReminders: {
          getRecentPosts: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await practiceHistoryCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.any(Object)] })
    );
  });

  it("renders recent practice reminder posts", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("reminders"),
        getUser: jest.fn().mockReturnValue(null),
        getInteger: jest.fn().mockReturnValue(2),
      },
    });
    const context = {
      correlationId: "corr-2",
      services: {
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([]),
          getProblemDict: jest
            .fn()
            .mockReturnValue(
              new Map([
                ["1000B", { contestId: 1000, index: "B", name: "Reminder", rating: 900, tags: [] }],
              ])
            ),
        },
        store: {
          getPracticeSuggestionHistory: jest.fn(),
        },
        practiceReminders: {
          getRecentPosts: jest
            .fn()
            .mockResolvedValue([{ problemId: "1000B", sentAt: "2024-01-02T00:00:00.000Z" }]),
        },
      },
    } as unknown as CommandContext;

    await practiceHistoryCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.any(Object)] })
    );
  });
});
