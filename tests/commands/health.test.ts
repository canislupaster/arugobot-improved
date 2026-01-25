import type { ChatInputCommandInteraction } from "discord.js";

import { healthCommand } from "../../src/commands/health.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = () =>
  ({
    guild: { id: "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("healthCommand", () => {
  it("renders command usage metrics", async () => {
    const interaction = createInteraction();
    const context = {
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
        contestReminders: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        contestRatingAlerts: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
          getLastTickAt: jest.fn().mockReturnValue(null),
          getLastError: jest.fn().mockReturnValue(null),
        },
        practiceReminders: {
          getSubscriptionCount: jest.fn().mockResolvedValue(0),
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
});
