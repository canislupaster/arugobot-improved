import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

import { contestRemindersCommand } from "../../src/commands/contestReminders.js";
import type { CommandContext } from "../../src/types/commandContext.js";
import { publicFlags } from "../../src/utils/discordFlags.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "contestreminders",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getSubcommand: jest.fn(),
      getChannel: jest.fn(),
      getInteger: jest.fn(),
      getBoolean: jest.fn(),
      getRole: jest.fn(),
      getString: jest.fn(),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("contestRemindersCommand", () => {
  it("shows status when no reminders are configured", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("status"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-1",
      services: {
        contestReminders: {
          getSubscription: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No contest reminders configured for this server.",
      ...publicFlags,
    });
  });

  it("sets reminders for the specified channel", async () => {
    const channel = {
      id: "channel-1",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getChannel: jest.fn().mockReturnValue(channel),
        getInteger: jest.fn().mockReturnValue(null),
        getRole: jest.fn().mockReturnValue({ id: "role-1" }),
        getString: jest.fn().mockReturnValueOnce("div. 2").mockReturnValueOnce("kotlin"),
      },
    });
    const context = {
      correlationId: "corr-2",
      services: {
        contestReminders: {
          setSubscription: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(context.services.contestReminders.setSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-1",
      30,
      "role-1",
      ["div. 2"],
      ["kotlin"]
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "Contest reminders enabled in <#channel-1> (30 minutes before) (mentioning <@&role-1>) (include: div. 2, exclude: kotlin).",
      ...publicFlags,
    });
  });

  it("clears reminders when requested", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("clear"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-3",
      services: {
        contestReminders: {
          clearSubscription: jest.fn().mockResolvedValue(true),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Contest reminders disabled for this server.",
      ...publicFlags,
    });
  });

  it("previews the next reminder when configured", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("preview"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-4",
      services: {
        contestReminders: {
          getSubscription: jest.fn().mockResolvedValue({
            guildId: "guild-1",
            channelId: "channel-1",
            minutesBefore: 30,
            roleId: null,
            includeKeywords: [],
            excludeKeywords: [],
          }),
        },
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getUpcoming: jest.fn().mockReturnValue([
            {
              id: 101,
              name: "CF Round",
              phase: "BEFORE",
              startTimeSeconds: 1_700_000_000,
              durationSeconds: 7200,
            },
          ]),
          getLastRefreshAt: jest.fn().mockReturnValue(1_700_000_000),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    const payload = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Contest reminder preview");
    expect(payload.flags).toBeUndefined();
  });

  it("returns an error when previewing without a subscription", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("preview"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-5",
      services: {
        contestReminders: {
          getSubscription: jest.fn().mockResolvedValue(null),
        },
        contests: {
          refresh: jest.fn(),
          getUpcoming: jest.fn(),
          getLastRefreshAt: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No contest reminders configured for this server.",
      ...publicFlags,
    });
  });

  it("posts a manual reminder for the next contest", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("post"),
        getBoolean: jest.fn().mockReturnValue(false),
      },
    });
    const context = {
      correlationId: "corr-6",
      client: {} as never,
      services: {
        contestReminders: {
          sendManualReminder: jest.fn().mockResolvedValue({
            status: "sent",
            contestId: 123,
            contestName: "CF Round",
            channelId: "channel-1",
            minutesBefore: 30,
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ...publicFlags });
    expect(interaction.editReply).toHaveBeenCalledWith(
      "Posted a reminder for CF Round in <#channel-1>."
    );
  });
});
