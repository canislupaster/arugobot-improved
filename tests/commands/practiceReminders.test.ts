import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

import { practiceRemindersCommand } from "../../src/commands/practiceReminders.js";
import type { CommandContext } from "../../src/types/commandContext.js";
import { publicFlags } from "../../src/utils/discordFlags.js";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "practicereminders",
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

describe("practiceRemindersCommand", () => {
  it("shows status when no reminders are configured", async () => {
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
      correlationId: "corr-1",
      services: {
        practiceReminders: {
          getSubscription: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await practiceRemindersCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No practice reminders configured for this server.",
      ...publicFlags,
    });
  });

  it("sets practice reminders with defaults", async () => {
    const channel = {
      id: "channel-1",
      type: ChannelType.GuildText,
    };
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
      correlationId: "corr-2",
      services: {
        practiceReminders: {
          setSubscription: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as CommandContext;

    await practiceRemindersCommand.execute(interaction, context);

    expect(context.services.practiceReminders.setSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-1",
      9,
      0,
      0,
      ALL_DAYS,
      [{ min: 800, max: 3500 }],
      "",
      null
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Practice reminders enabled in <#channel-1> (daily at 09:00 UTC).",
      ...publicFlags,
    });
  });

  it("sets practice reminders with custom days", async () => {
    const channel = {
      id: "channel-1",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getChannel: jest.fn().mockReturnValue(channel),
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn((name: string) => {
          if (name === "days") {
            return "mon,wed,fri";
          }
          return null;
        }),
        getBoolean: jest.fn(),
        getRole: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-2b",
      services: {
        practiceReminders: {
          setSubscription: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as CommandContext;

    await practiceRemindersCommand.execute(interaction, context);

    expect(context.services.practiceReminders.setSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-1",
      9,
      0,
      0,
      [1, 3, 5],
      [{ min: 800, max: 3500 }],
      "",
      null
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Practice reminders enabled in <#channel-1> (mon, wed, fri at 09:00 UTC).",
      ...publicFlags,
    });
  });

  it("clears practice reminders when requested", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("clear"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn(),
        getBoolean: jest.fn(),
        getRole: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-3",
      services: {
        practiceReminders: {
          clearSubscription: jest.fn().mockResolvedValue(true),
        },
      },
    } as unknown as CommandContext;

    await practiceRemindersCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Practice reminders disabled for this server.",
      ...publicFlags,
    });
  });

  it("sets practice reminders with a role mention", async () => {
    const channel = {
      id: "channel-2",
      type: ChannelType.GuildText,
    };
    const role = { id: "role-1" };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getChannel: jest.fn().mockReturnValue(channel),
        getInteger: jest.fn((name: string) => {
          if (name === "hour_utc") {
            return 10;
          }
          if (name === "minute_utc") {
            return 0;
          }
          return null;
        }),
        getString: jest.fn().mockReturnValue(null),
        getBoolean: jest.fn(),
        getRole: jest.fn().mockReturnValue(role),
      },
    });
    const context = {
      correlationId: "corr-3b",
      services: {
        practiceReminders: {
          setSubscription: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as CommandContext;

    await practiceRemindersCommand.execute(interaction, context);

    expect(context.services.practiceReminders.setSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-2",
      10,
      0,
      0,
      ALL_DAYS,
      [{ min: 800, max: 3500 }],
      "",
      "role-1"
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "Practice reminders enabled in <#channel-2> (daily at 10:00 UTC) (mentioning <@&role-1>).",
      ...publicFlags,
    });
  });

  it("accepts a UTC offset and converts local time to UTC", async () => {
    const channel = {
      id: "channel-3",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getChannel: jest.fn().mockReturnValue(channel),
        getInteger: jest.fn((name: string) => {
          if (name === "hour_utc") {
            return 9;
          }
          if (name === "minute_utc") {
            return 0;
          }
          return null;
        }),
        getString: jest.fn((name: string) => {
          if (name === "utc_offset") {
            return "+02:30";
          }
          return null;
        }),
        getBoolean: jest.fn(),
        getRole: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-3c",
      services: {
        practiceReminders: {
          setSubscription: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as CommandContext;

    await practiceRemindersCommand.execute(interaction, context);

    expect(context.services.practiceReminders.setSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-3",
      6,
      30,
      150,
      ALL_DAYS,
      [{ min: 800, max: 3500 }],
      "",
      null
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "Practice reminders enabled in <#channel-3> (daily at 09:00 (UTC+02:30); 06:30 UTC).",
      ...publicFlags,
    });
  });

  it("rejects invalid UTC offsets", async () => {
    const channel = {
      id: "channel-4",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getChannel: jest.fn().mockReturnValue(channel),
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn((name: string) => {
          if (name === "utc_offset") {
            return "+25:00";
          }
          return null;
        }),
        getBoolean: jest.fn(),
        getRole: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-3d",
      services: {
        practiceReminders: {
          setSubscription: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as CommandContext;

    await practiceRemindersCommand.execute(interaction, context);

    expect(context.services.practiceReminders.setSubscription).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "UTC offset must be between -12:00 and +14:00.",
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
        getBoolean: jest.fn(),
        getRole: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-4",
      services: {
        practiceReminders: {
          getPreview: jest.fn().mockResolvedValue({
            subscription: {
              guildId: "guild-1",
              channelId: "channel-1",
              hourUtc: 9,
              minuteUtc: 0,
              utcOffsetMinutes: 0,
              daysOfWeek: ALL_DAYS,
              ratingRanges: [{ min: 800, max: 1000 }],
              tags: "",
              roleId: null,
              lastSentAt: null,
            },
            nextScheduledAt: 1_700_000_000_000,
            problem: {
              contestId: 100,
              index: "A",
              name: "Sample",
              rating: 900,
              tags: ["dp"],
            },
            skippedHandles: 0,
            staleHandles: 0,
            candidateCount: 100,
          }),
        },
      },
    } as unknown as CommandContext;

    await practiceRemindersCommand.execute(interaction, context);

    const payload = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Practice reminder preview");
    expect(payload.flags).toBeUndefined();
  });

  it("posts a practice reminder immediately", async () => {
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
      correlationId: "corr-5",
      client: { user: { id: "bot-1" } },
      services: {
        practiceReminders: {
          sendManualReminder: jest.fn().mockResolvedValue({
            status: "sent",
            problemId: "100A",
            channelId: "channel-1",
          }),
        },
      },
    } as unknown as CommandContext;

    await practiceRemindersCommand.execute(interaction, context);

    expect(context.services.practiceReminders.sendManualReminder).toHaveBeenCalledWith(
      "guild-1",
      context.client,
      false
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      "Posted a practice problem in <#channel-1>."
    );
  });
});
