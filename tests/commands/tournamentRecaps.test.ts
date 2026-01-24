import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

import { tournamentRecapsCommand } from "../../src/commands/tournamentRecaps.js";
import type { CommandContext } from "../../src/types/commandContext.js";
import { ephemeralFlags } from "../../src/utils/discordFlags.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "tournamentrecaps",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getSubcommand: jest.fn(),
      getChannel: jest.fn(),
      getRole: jest.fn(),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("tournamentRecapsCommand", () => {
  it("shows status when no recaps are configured", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("status"),
      },
    });
    const context = {
      correlationId: "corr-1",
      services: {
        tournamentRecaps: {
          getSubscription: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await tournamentRecapsCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No tournament recap auto-posts configured for this server.",
      ...ephemeralFlags,
    });
  });

  it("sets recap auto-posts for the specified channel", async () => {
    const channel = {
      id: "channel-1",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getChannel: jest.fn().mockReturnValue(channel),
        getRole: jest.fn().mockReturnValue({ id: "role-1" }),
      },
    });
    const context = {
      correlationId: "corr-2",
      services: {
        tournamentRecaps: {
          setSubscription: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as CommandContext;

    await tournamentRecapsCommand.execute(interaction, context);

    expect(context.services.tournamentRecaps.setSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-1",
      "role-1"
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Tournament recaps will auto-post in <#channel-1> (mentioning <@&role-1>).",
      ...ephemeralFlags,
    });
  });

  it("posts the latest recap when requested", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("post"),
      },
    });
    const context = {
      correlationId: "corr-3",
      client: {} as never,
      services: {
        tournamentRecaps: {
          postLatestCompletedRecap: jest.fn().mockResolvedValue({
            status: "no_completed",
          }),
        },
      },
    } as unknown as CommandContext;

    await tournamentRecapsCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("No completed tournaments to recap.");
  });
});
