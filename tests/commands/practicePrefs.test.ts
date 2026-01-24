import type { ChatInputCommandInteraction } from "discord.js";

import { practicePrefsCommand } from "../../src/commands/practicePrefs.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    user: { id: "user-1" },
    guild: { id: "guild-1" },
    options: {
      getSubcommand: jest.fn(),
      getInteger: jest.fn().mockReturnValue(null),
      getString: jest.fn().mockReturnValue(null),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("practicePrefsCommand", () => {
  it("reports missing preferences on status", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("status"),
        getInteger: jest.fn(),
        getString: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-1",
      services: {
        store: {
          getPracticePreferences: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await practicePrefsCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No practice preferences saved yet. Use /practiceprefs set to configure.",
      ephemeral: true,
    });
  });

  it("saves preferences on set", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getInteger: jest.fn((name: string) => (name === "rating" ? 1200 : null)),
        getString: jest.fn((name: string) => (name === "tags" ? "dp" : null)),
      },
    });
    const setPracticePreferences = jest.fn().mockResolvedValue(undefined);
    const context = {
      correlationId: "corr-2",
      services: {
        store: {
          getPracticePreferences: jest.fn().mockResolvedValue(null),
          setPracticePreferences,
        },
      },
    } as unknown as CommandContext;

    await practicePrefsCommand.execute(interaction, context);

    expect(setPracticePreferences).toHaveBeenCalledWith(
      "guild-1",
      "user-1",
      [{ min: 1200, max: 1200 }],
      "dp"
    );
  });
});
