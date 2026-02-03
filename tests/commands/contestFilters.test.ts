import type { ChatInputCommandInteraction } from "discord.js";

import { contestFiltersCommand } from "../../src/commands/contestFilters.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (options: {
  subcommand: string;
  include?: string | null;
  exclude?: string | null;
  scope?: string | null;
}) =>
  ({
    guild: { id: "guild-1" },
    options: {
      getSubcommand: jest.fn().mockReturnValue(options.subcommand),
      getString: jest.fn((name: string) => {
        if (name === "include") {
          return options.include ?? null;
        }
        if (name === "exclude") {
          return options.exclude ?? null;
        }
        if (name === "scope") {
          return options.scope ?? null;
        }
        return null;
      }),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("contestFiltersCommand", () => {
  it("reports when no defaults are configured", async () => {
    const interaction = createInteraction({ subcommand: "status" });
    const context = {
      services: {
        contestFilters: {
          getSettings: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await contestFiltersCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No default contest filters configured.",
      flags: 64,
    });
  });

  it("saves defaults when provided", async () => {
    const interaction = createInteraction({
      subcommand: "set",
      include: "div. 2",
      scope: "gym",
    });
    const context = {
      services: {
        contestFilters: {
          setSettings: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as CommandContext;

    await contestFiltersCommand.execute(interaction, context);

    expect(context.services.contestFilters.setSettings).toHaveBeenCalledWith("guild-1", {
      includeKeywords: "div. 2",
      excludeKeywords: null,
      scope: "gym",
    });
  });
});
