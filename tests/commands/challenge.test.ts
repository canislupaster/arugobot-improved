import type { ChatInputCommandInteraction } from "discord.js";

import { challengeCommand } from "../../src/commands/challenge.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "challenge",
    user: { id: "user-1", username: "Host" },
    guild: { id: "guild-1" },
    channelId: "channel-1",
    options: {
      getString: jest.fn(),
      getInteger: jest.fn(),
      getBoolean: jest.fn(),
      getUser: jest.fn(),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue({ id: "message-1" }),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("challengeCommand", () => {
  it("rejects invalid max participants", async () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn().mockReturnValue(null),
        getInteger: jest.fn((name: string) => {
          if (name === "length") {
            return 40;
          }
          if (name === "max_participants") {
            return 1;
          }
          return null;
        }),
        getBoolean: jest.fn().mockReturnValue(false),
        getUser: jest.fn().mockReturnValue(null),
      },
    });
    const context = { correlationId: "corr-1" } as CommandContext;

    await challengeCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Invalid max participants. Choose 2-10.",
      ephemeral: true,
    });
  });

  it("rejects too many participants", async () => {
    const userMap = new Map(
      ["user1", "user2", "user3", "user4", "user5"].map((key, index) => [
        key,
        { id: `user-${index + 2}`, username: `User ${index + 2}` },
      ])
    );
    const interaction = createInteraction({
      options: {
        getString: jest.fn((name: string) => (name === "problem" ? "1000A" : null)),
        getInteger: jest.fn((name: string) => {
          if (name === "length") {
            return 40;
          }
          return null;
        }),
        getBoolean: jest.fn().mockReturnValue(false),
        getUser: jest.fn((name: string) => userMap.get(name) ?? null),
      },
    });
    const context = { correlationId: "corr-2" } as CommandContext;

    await challengeCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith("Too many users (limit is 5).");
  });
});
