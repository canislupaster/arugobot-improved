import type { ChatInputCommandInteraction } from "discord.js";

import { healthCommand } from "../../src/commands/health.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createClient = () =>
  ({
    user: { id: "bot-1" },
    channels: {
      fetch: jest.fn().mockResolvedValue(null),
    },
  }) as unknown as CommandContext["client"];

const createInteraction = () =>
  ({
    guild: { id: "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("healthCommand", () => {
  it("renders command usage metrics", async () => {
    const interaction = createInteraction();
    const context = {
      client: createClient(),
      webStatus: {
        status: "listening",
        host: "0.0.0.0",
        requestedPort: 8787,
        actualPort: 8787,
        lastError: null,
      },
      services: {
        metrics: {
          getCommandCount: jest.fn().mockResolvedValue(2),
          getUniqueCommandCount: jest.fn().mockResolvedValue(2),
          getLastCommandAt: jest.fn().mockResolvedValue(new Date().toISOString()),
          getCommandUsageSummary: jest.fn().mockResolvedValue([
            {
              name: "ping",
              count: 1,
              successRate: 100,
              avgLatencyMs: 42,
              maxLatencyMs: 42,
              lastSeenAt: new Date().toISOString(),
            },
          ]),
        },
        store: { checkDb: jest.fn().mockResolvedValue(true) },
        codeforces: {
          getLastError: jest.fn().mockReturnValue(null),
          getLastSuccessAt: jest.fn().mockReturnValue(null),
        },
        problems: {
          getLastRefreshAt: jest.fn().mockReturnValue(0),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contests: {
          getLastRefreshAt: jest.fn().mockReturnValue(0),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestRatingChanges: {
          getLastError: jest.fn().mockReturnValue(null),
        },
        ratingChanges: {
          getLastError: jest.fn().mockReturnValue(null),
        },
        databaseBackups: {
          getBackupDir: jest.fn().mockReturnValue(null),
          getLastBackupAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestReminders: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          listSubscriptions: jest.fn().mockResolvedValue([]),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestRatingAlerts: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          listSubscriptions: jest.fn().mockResolvedValue([]),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        practiceReminders: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          getSubscription: jest.fn().mockResolvedValue(null),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        weeklyDigest: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          getSubscription: jest.fn().mockResolvedValue(null),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        challenges: {
          getActiveCount: jest.fn().mockResolvedValue(0),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        tournaments: {
          getActiveCount: jest.fn().mockResolvedValue(0),
          getLastError: jest.fn().mockReturnValue(null),
        },
        tournamentRecaps: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          getSubscription: jest.fn().mockResolvedValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        tokenUsage: {
          getSnapshot: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
      },
    } as unknown as CommandContext;

    await healthCommand.execute(interaction, context);

    const replyArg = (interaction.reply as jest.Mock).mock.calls[0]?.[0];
    const fields = replyArg.embeds[0].data.fields ?? [];
    const names = fields.map((field: { name: string }) => field.name);
    expect(names).toContain("Top commands");
    expect(names).toContain("Commands handled");
  });

  it("includes misconfigured reminder channels", async () => {
    const interaction = createInteraction();
    const context = {
      client: createClient(),
      webStatus: {
        status: "listening",
        host: "0.0.0.0",
        requestedPort: 8787,
        actualPort: 8787,
        lastError: null,
      },
      services: {
        metrics: {
          getCommandCount: jest.fn().mockResolvedValue(0),
          getUniqueCommandCount: jest.fn().mockResolvedValue(0),
          getLastCommandAt: jest.fn().mockResolvedValue(null),
          getCommandUsageSummary: jest.fn().mockResolvedValue([]),
        },
        store: { checkDb: jest.fn().mockResolvedValue(true) },
        codeforces: {
          getLastError: jest.fn().mockReturnValue(null),
          getLastSuccessAt: jest.fn().mockReturnValue(null),
        },
        problems: {
          getLastRefreshAt: jest.fn().mockReturnValue(0),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contests: {
          getLastRefreshAt: jest.fn().mockReturnValue(0),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestRatingChanges: {
          getLastError: jest.fn().mockReturnValue(null),
        },
        ratingChanges: {
          getLastError: jest.fn().mockReturnValue(null),
        },
        databaseBackups: {
          getBackupDir: jest.fn().mockReturnValue(null),
          getLastBackupAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestReminders: {
          getSubscriptionCount: jest.fn().mockResolvedValue(1),
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
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestRatingAlerts: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          listSubscriptions: jest.fn().mockResolvedValue([]),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        practiceReminders: {
          getSubscriptionCount: jest.fn().mockResolvedValue(1),
          getSubscription: jest.fn().mockResolvedValue({
            guildId: "guild-1",
            channelId: "channel-2",
            hourUtc: 9,
            minuteUtc: 0,
            utcOffsetMinutes: 0,
            daysOfWeek: [1],
            ratingRanges: [],
            tags: "",
            roleId: null,
            lastSentAt: null,
          }),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        weeklyDigest: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          getSubscription: jest.fn().mockResolvedValue(null),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        challenges: {
          getActiveCount: jest.fn().mockResolvedValue(0),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        tournaments: {
          getActiveCount: jest.fn().mockResolvedValue(0),
          getLastError: jest.fn().mockReturnValue(null),
        },
        tournamentRecaps: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          getSubscription: jest.fn().mockResolvedValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        tokenUsage: {
          getSnapshot: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
      },
    } as unknown as CommandContext;

    await healthCommand.execute(interaction, context);

    const replyArg = (interaction.reply as jest.Mock).mock.calls[0]?.[0];
    const fields = replyArg.embeds[0].data.fields ?? [];
    const channelField = fields.find((field: { name: string }) => field.name === "Channel issues");
    expect(channelField?.value).toContain("Contest reminder");
    expect(channelField?.value).toContain("Practice reminder");
  });

  it("dedupes channel status lookups across subscriptions", async () => {
    const interaction = createInteraction();
    const client = createClient();
    const context = {
      client,
      webStatus: {
        status: "listening",
        host: "0.0.0.0",
        requestedPort: 8787,
        actualPort: 8787,
        lastError: null,
      },
      services: {
        metrics: {
          getCommandCount: jest.fn().mockResolvedValue(0),
          getUniqueCommandCount: jest.fn().mockResolvedValue(0),
          getLastCommandAt: jest.fn().mockResolvedValue(null),
          getCommandUsageSummary: jest.fn().mockResolvedValue([]),
        },
        store: { checkDb: jest.fn().mockResolvedValue(true) },
        codeforces: {
          getLastError: jest.fn().mockReturnValue(null),
          getLastSuccessAt: jest.fn().mockReturnValue(null),
        },
        problems: {
          getLastRefreshAt: jest.fn().mockReturnValue(0),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contests: {
          getLastRefreshAt: jest.fn().mockReturnValue(0),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestRatingChanges: {
          getLastError: jest.fn().mockReturnValue(null),
        },
        ratingChanges: {
          getLastError: jest.fn().mockReturnValue(null),
        },
        databaseBackups: {
          getBackupDir: jest.fn().mockReturnValue(null),
          getLastBackupAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestReminders: {
          getSubscriptionCount: jest.fn().mockResolvedValue(2),
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
            {
              id: "sub-2",
              guildId: "guild-1",
              channelId: "channel-1",
              minutesBefore: 60,
              roleId: null,
              includeKeywords: [],
              excludeKeywords: [],
              scope: "official",
            },
          ]),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestRatingAlerts: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          listSubscriptions: jest.fn().mockResolvedValue([]),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        practiceReminders: {
          getSubscriptionCount: jest.fn().mockResolvedValue(1),
          getSubscription: jest.fn().mockResolvedValue({
            guildId: "guild-1",
            channelId: "channel-1",
            hourUtc: 9,
            minuteUtc: 0,
            utcOffsetMinutes: 0,
            daysOfWeek: [1],
            ratingRanges: [],
            tags: "",
            roleId: null,
            lastSentAt: null,
          }),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        weeklyDigest: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          getSubscription: jest.fn().mockResolvedValue(null),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        challenges: {
          getActiveCount: jest.fn().mockResolvedValue(0),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        tournaments: {
          getActiveCount: jest.fn().mockResolvedValue(0),
          getLastError: jest.fn().mockReturnValue(null),
        },
        tournamentRecaps: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          getSubscription: jest.fn().mockResolvedValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        tokenUsage: {
          getSnapshot: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
      },
    } as unknown as CommandContext;

    await healthCommand.execute(interaction, context);

    expect(client.channels.fetch).toHaveBeenCalledTimes(1);
  });
});
