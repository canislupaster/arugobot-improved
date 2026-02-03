import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

import { contestRemindersCommand } from "../../src/commands/contestReminders.js";
import type { CommandContext } from "../../src/types/commandContext.js";

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

const createClient = (channel: { id: string; type: ChannelType }, canSend = true) => ({
  user: { id: "bot-1" },
  channels: {
    fetch: jest.fn().mockResolvedValue({
      ...channel,
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn().mockReturnValue(canSend),
      }),
    }),
  },
});

describe("contestRemindersCommand", () => {
  it("shows status when no reminders are configured", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("status"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-1",
      services: {
        contestReminders: {
          listSubscriptions: jest.fn().mockResolvedValue([]),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No contest reminders configured for this server.",
    });
  });

  it("adds reminders for the specified channel", async () => {
    const channel = {
      id: "channel-1",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("add"),
        getChannel: jest.fn().mockReturnValue(channel),
        getInteger: jest.fn().mockReturnValue(null),
        getRole: jest.fn().mockReturnValue({ id: "role-1" }),
        getString: jest
          .fn()
          .mockReturnValueOnce("div. 2")
          .mockReturnValueOnce("kotlin")
          .mockReturnValueOnce(null),
      },
    });
    const context = {
      correlationId: "corr-2",
      client: createClient(channel),
      services: {
        contestReminders: {
          createSubscription: jest.fn().mockResolvedValue({
            id: "sub-1",
            guildId: "guild-1",
            channelId: "channel-1",
            minutesBefore: 30,
            roleId: "role-1",
            includeKeywords: ["div. 2"],
            excludeKeywords: ["kotlin"],
            scope: "official",
          }),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(context.services.contestReminders.createSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-1",
      30,
      "role-1",
      ["div. 2"],
      ["kotlin"],
      "official"
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "Contest reminders enabled in <#channel-1> (30 minutes before, Official) (mentioning <@&role-1>) (include: div. 2, exclude: kotlin). Subscription id: `sub-1`.",
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
          clearSubscriptions: jest.fn().mockResolvedValue(2),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Removed 2 contest reminder subscriptions.",
    });
  });

  it("adds reminders using a preset", async () => {
    const channel = {
      id: "channel-2",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("preset"),
        getChannel: jest.fn().mockReturnValue(channel),
        getInteger: jest.fn().mockReturnValue(45),
        getRole: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValueOnce("div2").mockReturnValueOnce(null),
      },
    });
    const context = {
      correlationId: "corr-3a",
      client: createClient(channel),
      services: {
        contestReminders: {
          createSubscription: jest.fn().mockResolvedValue({
            id: "sub-10",
            guildId: "guild-1",
            channelId: "channel-2",
            minutesBefore: 45,
            roleId: null,
            includeKeywords: ["div. 2", "div.2", "div 2"],
            excludeKeywords: [],
            scope: "official",
          }),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(context.services.contestReminders.createSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-2",
      45,
      null,
      ["div. 2", "div.2", "div 2"],
      [],
      "official"
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'Contest reminder preset "Div 2" enabled in <#channel-2> (45 minutes before, Official) (include: div. 2, div.2, div 2, exclude: none). Subscription id: `sub-10`.',
    });
  });

  it("rejects reminders for channels without permissions", async () => {
    const channel = {
      id: "channel-3",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("add"),
        getChannel: jest.fn().mockReturnValue(channel),
        getInteger: jest.fn().mockReturnValue(null),
        getRole: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const createSubscription = jest.fn();
    const context = {
      correlationId: "corr-3b",
      client: createClient(channel, false),
      services: {
        contestReminders: {
          createSubscription,
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(createSubscription).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "I can't post in <#channel-3> (Missing permissions (ViewChannel, SendMessages)). Check the bot permissions and try again.",
    });
  });

  it("shows next reminder info in the status list", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("status"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-status",
      client: {
        channels: {
          fetch: jest.fn().mockResolvedValue({ type: ChannelType.GuildText }),
        },
      },
      services: {
        contestReminders: {
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              id: "sub-1",
              guildId: "guild-1",
              channelId: "channel-1",
              minutesBefore: 30,
              roleId: null,
              includeKeywords: [],
              excludeKeywords: [],
              scope: "official",
            },
          ]),
          getLastNotificationMap: jest
            .fn()
            .mockResolvedValue(new Map([["sub-1", "2026-02-01T00:00:00.000Z"]])),
        },
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1_700_000_000),
          getUpcomingContests: jest.fn().mockReturnValue([
            {
              id: 303,
              name: "CF Reminder Round",
              phase: "BEFORE",
              startTimeSeconds: 1_700_000_000,
              durationSeconds: 7200,
            },
          ]),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    const payload = (interaction.reply as jest.Mock).mock.calls[0][0];
    const fieldValue = payload.embeds[0].data.fields[0].value as string;
    expect(fieldValue).toContain("Next:");
    expect(fieldValue).toContain("CF Reminder Round");
    expect(fieldValue).toContain("Reminder:");
    expect(fieldValue).toContain("Last sent: 2026-02-01T00:00:00.000Z");
  });

  it("removes a reminder subscription by id", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("remove"),
        getString: jest.fn().mockReturnValue("sub-1"),
      },
    });
    const context = {
      correlationId: "corr-3b",
      services: {
        contestReminders: {
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              id: "sub-1",
              guildId: "guild-1",
              channelId: "channel-1",
              minutesBefore: 30,
              roleId: null,
              includeKeywords: [],
              excludeKeywords: [],
              scope: "official",
            },
          ]),
          removeSubscription: jest.fn().mockResolvedValue(true),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Removed contest reminder subscription `sub-1`.",
    });
  });

  it("previews the next reminder when configured", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("preview"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-4",
      services: {
        contestReminders: {
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              id: "sub-1",
              guildId: "guild-1",
              channelId: "channel-1",
              minutesBefore: 30,
              roleId: null,
              includeKeywords: [],
              excludeKeywords: [],
              scope: "official",
            },
          ]),
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

  it("previews gym reminders using the gym scope", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("preview"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const refresh = jest.fn().mockResolvedValue(undefined);
    const getUpcoming = jest.fn().mockReturnValue([
      {
        id: 202,
        name: "Gym Round",
        phase: "BEFORE",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
      },
    ]);
    const context = {
      correlationId: "corr-4b",
      services: {
        contestReminders: {
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              id: "sub-2",
              guildId: "guild-1",
              channelId: "channel-1",
              minutesBefore: 30,
              roleId: null,
              includeKeywords: [],
              excludeKeywords: [],
              scope: "gym",
            },
          ]),
        },
        contests: {
          refresh,
          getUpcoming,
          getLastRefreshAt: jest.fn().mockReturnValue(1_700_000_000),
        },
      },
    } as unknown as CommandContext;

    await contestRemindersCommand.execute(interaction, context);

    expect(refresh).toHaveBeenCalledWith(false, "gym");
    expect(getUpcoming).toHaveBeenCalledWith(10, "gym");
  });

  it("returns an error when previewing without a subscription", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("preview"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-5",
      services: {
        contestReminders: {
          listSubscriptions: jest.fn().mockResolvedValue([]),
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
    });
  });

  it("posts a manual reminder for the next contest", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("post"),
        getBoolean: jest.fn().mockReturnValue(false),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-6",
      client: {} as never,
      services: {
        contestReminders: {
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              id: "sub-1",
              guildId: "guild-1",
              channelId: "channel-1",
              minutesBefore: 30,
              roleId: null,
              includeKeywords: [],
              excludeKeywords: [],
              scope: "official",
            },
          ]),
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

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      "Posted a reminder for CF Round in <#channel-1>."
    );
  });
});
