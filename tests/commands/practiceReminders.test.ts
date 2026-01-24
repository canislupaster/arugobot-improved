import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

import { practiceRemindersCommand } from "../../src/commands/practiceReminders.js";
import type { CommandContext } from "../../src/types/commandContext.js";

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
    },
    reply: jest.fn().mockResolvedValue(undefined),
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
      ephemeral: true,
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
      [{ min: 800, max: 3500 }],
      ""
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Practice reminders enabled in <#channel-1> (daily at 09:00 UTC).",
      ephemeral: true,
    });
  });

  it("clears practice reminders when requested", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("clear"),
        getChannel: jest.fn(),
        getInteger: jest.fn(),
        getString: jest.fn(),
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
      ephemeral: true,
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
        practiceReminders: {
          getPreview: jest.fn().mockResolvedValue({
            subscription: {
              guildId: "guild-1",
              channelId: "channel-1",
              hourUtc: 9,
              minuteUtc: 0,
              ratingRanges: [{ min: 800, max: 1000 }],
              tags: "",
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
    expect(payload.ephemeral).toBe(true);
  });
});
