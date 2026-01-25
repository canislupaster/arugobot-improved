import type { ChatInputCommandInteraction } from "discord.js";

import { handleCommandInteraction } from "../../src/commands/handler.js";
import type { Command } from "../../src/commands/types.js";
import type { WebServerStatus } from "../../src/types/webStatus.js";
import { CooldownManager } from "../../src/utils/cooldown.js";

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
  const webStatus: WebServerStatus = {
    status: "starting",
    host: "127.0.0.1",
    requestedPort: 0,
    actualPort: null,
    lastError: null,
  };
  const metrics = {
    recordCommandResult: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    metrics.recordCommandResult.mockClear();
  });

  it("replies when command is unknown", async () => {
    const interaction = createInteraction({ commandName: "missing" });
    const context = {
      client: {} as never,
      config: {} as never,
      commandSummaries: [],
      correlationId: "corr-1",
      webStatus,
      services: { metrics } as never,
    };
    const cooldowns = new CooldownManager(1, 1);

    await handleCommandInteraction(interaction, new Map(), context, cooldowns, "corr-1");

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Unknown command.",
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
      webStatus,
      services: { metrics } as never,
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
      webStatus,
      services: { metrics } as never,
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
    });
  });
});
