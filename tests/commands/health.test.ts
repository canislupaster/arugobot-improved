import type { ChatInputCommandInteraction } from "discord.js";

import { healthCommand } from "../../src/commands/health.js";
import { recordCommandResult, resetCommandMetrics } from "../../src/services/metrics.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = () =>
  ({
    guild: { id: "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("healthCommand", () => {
  beforeEach(() => {
    resetCommandMetrics();
  });

  it("renders command usage metrics", async () => {
    recordCommandResult("ping", 42, true);
    recordCommandResult("help", 80, true);

    const interaction = createInteraction();
    const context = {
      services: {
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
        contestReminders: {
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
