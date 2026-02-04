import type { ChatInputCommandInteraction } from "discord.js";

import { buildCommandLogContext, logCommandError } from "../../src/utils/commandLogging.js";
import * as logger from "../../src/utils/logger.js";

describe("buildCommandLogContext", () => {
  const createInteraction = (guildId: string | null) =>
    ({
      commandName: "test",
      guildId,
      user: { id: "user-1" },
    }) as ChatInputCommandInteraction;

  it("uses the interaction guild id when available", () => {
    const interaction = createInteraction("guild-1");
    expect(buildCommandLogContext(interaction, "corr")).toEqual({
      correlationId: "corr",
      command: "test",
      guildId: "guild-1",
      userId: "user-1",
    });
  });

  it("prefers the explicit guild id override", () => {
    const interaction = createInteraction(null);
    expect(buildCommandLogContext(interaction, "corr", "override")).toEqual({
      correlationId: "corr",
      command: "test",
      guildId: "override",
      userId: "user-1",
    });
  });
});

describe("logCommandError", () => {
  const createInteraction = (guildId: string | null) =>
    ({
      commandName: "test",
      guildId,
      user: { id: "user-1" },
    }) as ChatInputCommandInteraction;

  it("logs errors with command context and extra fields", () => {
    const interaction = createInteraction("guild-1");
    const spy = jest.spyOn(logger, "logError").mockImplementation(() => {});

    logCommandError("boom", interaction, "corr", {
      guildId: "override",
      latencyMs: 42,
      extraKey: "value",
    });

    expect(spy).toHaveBeenCalledWith("boom", {
      correlationId: "corr",
      command: "test",
      guildId: "override",
      userId: "user-1",
      latencyMs: 42,
      extraKey: "value",
    });

    spy.mockRestore();
  });
});
