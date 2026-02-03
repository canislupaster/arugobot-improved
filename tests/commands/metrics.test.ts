import type { ChatInputCommandInteraction } from "discord.js";

import { metricsCommand } from "../../src/commands/metrics.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (options: { command?: string | null; limit?: number | null }) =>
  ({
    options: {
      getString: jest.fn((name: string) => (name === "command" ? options.command ?? null : null)),
      getInteger: jest.fn((name: string) => (name === "limit" ? options.limit ?? null : null)),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("metricsCommand", () => {
  it("renders a single command summary", async () => {
    const interaction = createInteraction({ command: "ping" });
    const context = {
      services: {
        metrics: {
          getCommandSummary: jest.fn().mockResolvedValue({
            name: "ping",
            count: 3,
            successRate: 100,
            avgLatencyMs: 42,
            maxLatencyMs: 90,
            lastSeenAt: new Date().toISOString(),
          }),
          getCommandUsageSummary: jest.fn().mockResolvedValue([]),
        },
      },
    } as unknown as CommandContext;

    await metricsCommand.execute(interaction, context);

    expect(context.services.metrics.getCommandSummary).toHaveBeenCalledWith("ping");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0]?.[0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toBe("Command metrics: /ping");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Count", value: "3" }),
        expect.objectContaining({ name: "Success rate", value: "100%" }),
      ])
    );
  });

  it("handles empty summary list", async () => {
    const interaction = createInteraction({});
    const context = {
      services: {
        metrics: {
          getCommandSummary: jest.fn().mockResolvedValue(null),
          getCommandUsageSummary: jest.fn().mockResolvedValue([]),
        },
      },
    } as unknown as CommandContext;

    await metricsCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("No command metrics recorded yet.");
  });
});
