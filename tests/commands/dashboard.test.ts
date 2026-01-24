import type { ChatInputCommandInteraction } from "discord.js";

import { dashboardCommand } from "../../src/commands/dashboard.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    guild: { id: "guild-1" },
    options: {
      getSubcommand: jest.fn().mockReturnValue("status"),
      getBoolean: jest.fn(),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("dashboardCommand", () => {
  it("shows default private status when unset", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        guildSettings: {
          getDashboardSettings: jest.fn().mockResolvedValue(null),
          clearDashboardSettings: jest.fn(),
          setDashboardPublic: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await dashboardCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("private by default"),
      })
    );
  });

  it("updates visibility on set", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getBoolean: jest.fn().mockReturnValue(true),
      },
    });
    const setDashboardPublic = jest.fn().mockResolvedValue(undefined);
    const context = {
      services: {
        guildSettings: {
          getDashboardSettings: jest.fn(),
          clearDashboardSettings: jest.fn(),
          setDashboardPublic,
        },
      },
    } as unknown as CommandContext;

    await dashboardCommand.execute(interaction, context);

    expect(setDashboardPublic).toHaveBeenCalledWith("guild-1", true);
  });

  it("clears visibility on clear", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("clear"),
        getBoolean: jest.fn(),
      },
    });
    const clearDashboardSettings = jest.fn().mockResolvedValue(undefined);
    const context = {
      services: {
        guildSettings: {
          getDashboardSettings: jest.fn(),
          clearDashboardSettings,
          setDashboardPublic: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await dashboardCommand.execute(interaction, context);

    expect(clearDashboardSettings).toHaveBeenCalledWith("guild-1");
  });
});
