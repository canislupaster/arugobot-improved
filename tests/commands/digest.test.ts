import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

import { digestCommand } from "../../src/commands/digest.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "digest",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getSubcommand: jest.fn(),
      getChannel: jest.fn(),
      getInteger: jest.fn(),
      getString: jest.fn(),
      getBoolean: jest.fn(),
      getRole: jest.fn(),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("digestCommand", () => {
  it("shows status when no subscription exists", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("status"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn(),
        getBoolean: jest.fn(),
        getRole: jest.fn(),
      },
    });
    const context = {
      services: {
        weeklyDigest: {
          getSubscription: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await digestCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No weekly digests configured for this server.",
    });
  });

  it("sets a digest with defaults", async () => {
    const channel = { id: "channel-1", type: ChannelType.GuildText };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getChannel: jest.fn().mockReturnValue(channel),
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
        getBoolean: jest.fn(),
        getRole: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      services: {
        weeklyDigest: {
          setSubscription: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as CommandContext;

    await digestCommand.execute(interaction, context);

    expect(context.services.weeklyDigest.setSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-1",
      1,
      9,
      0,
      0,
      null
    );
  });

  it("previews the digest", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("preview"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn(),
        getBoolean: jest.fn(),
        getRole: jest.fn(),
      },
    });
    const context = {
      services: {
        weeklyDigest: {
          getPreview: jest.fn().mockResolvedValue({
            nextScheduledAt: Date.now() + 1000,
            embed: { data: { title: "Weekly digest" } },
          }),
        },
      },
    } as unknown as CommandContext;

    await digestCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("posts the digest manually", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("post"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn(),
        getBoolean: jest.fn().mockReturnValue(false),
        getRole: jest.fn(),
      },
    });
    const context = {
      client: {},
      services: {
        weeklyDigest: {
          sendManualDigest: jest.fn().mockResolvedValue({ status: "sent", channelId: "channel-1" }),
        },
      },
    } as unknown as CommandContext;

    await digestCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Weekly digest sent.");
  });
});
