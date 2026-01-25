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
      config: { webPublicUrl: "https://example.com" },
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
      config: { webPublicUrl: "https://example.com" },
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
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("https://example.com/guilds/guild-1"),
      })
    );
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
      config: { webPublicUrl: "https://example.com" },
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

  it("includes dashboard URL in status when public", async () => {
    const interaction = createInteraction();
    const context = {
      config: { webPublicUrl: "https://example.com" },
      services: {
        guildSettings: {
          getDashboardSettings: jest.fn().mockResolvedValue({
            isPublic: true,
            updatedAt: "2024-01-01T00:00:00.000Z",
          }),
          clearDashboardSettings: jest.fn(),
          setDashboardPublic: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await dashboardCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("https://example.com/guilds/guild-1"),
      })
    );
  });
});
