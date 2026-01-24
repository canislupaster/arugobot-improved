import type { ChatInputCommandInteraction } from "discord.js";

import { handleCommandInteraction } from "../../src/commands/handler.js";
import type { Command } from "../../src/commands/types.js";
import { CooldownManager } from "../../src/utils/cooldown.js";
import { ephemeralFlags } from "../../src/utils/discordFlags.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "ping",
    user: { id: "user-1" },
    guildId: "guild-1",
    inGuild: () => true,
    memberPermissions: { has: jest.fn().mockReturnValue(true) },
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    deferred: false,
    replied: false,
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("handleCommandInteraction", () => {
  it("replies when command is unknown", async () => {
    const interaction = createInteraction({ commandName: "missing" });
    const context = {
      client: {} as never,
      config: {} as never,
      commandSummaries: [],
      correlationId: "corr-1",
      services: {} as never,
    };
    const cooldowns = new CooldownManager(1, 1);

    await handleCommandInteraction(interaction, new Map(), context, cooldowns, "corr-1");

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Unknown command.",
      ...ephemeralFlags,
    });
  });

  it("executes the command handler when allowed", async () => {
    const interaction = createInteraction();
    const execute = jest.fn().mockResolvedValue(undefined);
    const command: Command = {
      data: { name: "ping", description: "Ping" } as never,
      execute,
    };
    const context = {
      client: {} as never,
      config: {} as never,
      commandSummaries: [],
      correlationId: "corr-2",
      services: {} as never,
    };
    const cooldowns = new CooldownManager(0, 0);

    await handleCommandInteraction(
      interaction,
      new Map([["ping", command]]),
      context,
      cooldowns,
      "corr-2"
    );

    expect(execute).toHaveBeenCalled();
  });

  it("replies with error when command execution fails", async () => {
    const interaction = createInteraction();
    const execute = jest.fn().mockRejectedValue(new Error("boom"));
    const command: Command = {
      data: { name: "ping", description: "Ping" } as never,
      execute,
    };
    const context = {
      client: {} as never,
      config: {} as never,
      commandSummaries: [],
      correlationId: "corr-3",
      services: {} as never,
    };
    const cooldowns = new CooldownManager(0, 0);

    await handleCommandInteraction(
      interaction,
      new Map([["ping", command]]),
      context,
      cooldowns,
      "corr-3"
    );

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Something went wrong.",
      ...ephemeralFlags,
    });
  });
});
