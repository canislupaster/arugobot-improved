import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

import { contestRatingAlertsCommand } from "../../src/commands/contestRatingAlerts.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "contestratingalerts",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getSubcommand: jest.fn(),
      getChannel: jest.fn(),
      getBoolean: jest.fn(),
      getRole: jest.fn(),
      getString: jest.fn(),
      getInteger: jest.fn(),
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

describe("contestRatingAlertsCommand", () => {
  it("shows status when no alerts are configured", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("status"),
        getChannel: jest.fn(),
        getRole: jest.fn(),
        getString: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-1",
      services: {
        contestRatingAlerts: {
          listSubscriptions: jest.fn().mockResolvedValue([]),
        },
      },
    } as unknown as CommandContext;

    await contestRatingAlertsCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "No contest rating alerts configured for this server.",
    });
  });

  it("adds a rating alert subscription for the specified channel", async () => {
    const channel = {
      id: "channel-1",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getChannel: jest.fn().mockReturnValue(channel),
        getRole: jest.fn().mockReturnValue({ id: "role-1" }),
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-2",
      client: createClient(channel),
      services: {
        contestRatingAlerts: {
          createSubscription: jest.fn().mockResolvedValue({
            id: "sub-1",
            guildId: "guild-1",
            channelId: "channel-1",
            roleId: "role-1",
            minDelta: 0,
            includeHandles: [],
          }),
        },
      },
    } as unknown as CommandContext;

    await contestRatingAlertsCommand.execute(interaction, context);

    expect(context.services.contestRatingAlerts.createSubscription).toHaveBeenCalledWith(
      "guild-1",
      "channel-1",
      "role-1",
      { includeHandles: [], minDelta: 0 }
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "Contest rating alerts enabled in <#channel-1> (mentioning <@&role-1>). Subscription id: `sub-1`.",
    });
  });

  it("rejects alerts for channels without permissions", async () => {
    const channel = {
      id: "channel-2",
      type: ChannelType.GuildText,
    };
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("set"),
        getChannel: jest.fn().mockReturnValue(channel),
        getRole: jest.fn().mockReturnValue(null),
        getInteger: jest.fn().mockReturnValue(0),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const createSubscription = jest.fn();
    const context = {
      correlationId: "corr-2b",
      client: createClient(channel, false),
      services: {
        contestRatingAlerts: {
          createSubscription,
        },
      },
    } as unknown as CommandContext;

    await contestRatingAlertsCommand.execute(interaction, context);

    expect(createSubscription).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "I can't post in <#channel-2> (Missing permissions (ViewChannel, SendMessages)). Check the bot permissions and try again.",
    });
  });

  it("previews the next rating change alert when configured", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("preview"),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-3",
      services: {
        contestRatingAlerts: {
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              id: "sub-1",
              guildId: "guild-1",
              channelId: "channel-1",
              roleId: null,
              minDelta: 0,
              includeHandles: [],
            },
          ]),
          getPreview: jest.fn().mockResolvedValue({
            status: "ready",
            preview: {
              contest: {
                id: 101,
                name: "CF Round",
                phase: "FINISHED",
                startTimeSeconds: 1_700_000_000,
                durationSeconds: 7200,
              },
              entries: [
                {
                  handle: "tourist",
                  userId: "user-1",
                  change: {
                    handle: "tourist",
                    contestId: 101,
                    contestName: "CF Round",
                    rank: 10,
                    oldRating: 2000,
                    newRating: 2100,
                    ratingUpdateTimeSeconds: 1_700_000_100,
                  },
                },
              ],
              totalEntries: 1,
              isStale: false,
            },
          }),
        },
      },
    } as unknown as CommandContext;

    await contestRatingAlertsCommand.execute(interaction, context);

    const payload = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Contest rating changes published");
    expect(payload.flags).toBeUndefined();
  });
});
