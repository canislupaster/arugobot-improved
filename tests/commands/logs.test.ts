import type { ChatInputCommandInteraction } from "discord.js";

import { logsCommand } from "../../src/commands/logs.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (options: {
  level?: string | null;
  command?: string | null;
  correlation?: string | null;
  limit?: number | null;
  user?: { id: string; username: string } | null;
}) =>
  ({
    guild: { id: "guild-1" },
    options: {
      getInteger: jest.fn(() => options.limit ?? null),
      getString: jest.fn((name: string) => {
        if (name === "level") {
          return options.level ?? null;
        }
        if (name === "command") {
          return options.command ?? null;
        }
        if (name === "correlation") {
          return options.correlation ?? null;
        }
        return null;
      }),
      getUser: jest.fn().mockReturnValue(options.user ?? null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("logsCommand", () => {
  it("renders recent log entries", async () => {
    const interaction = createInteraction({
      level: "error",
      command: "ping",
      correlation: "abc",
      limit: 3,
    });
    const context = {
      services: {
        logs: {
          getRecentEntries: jest.fn().mockResolvedValue([
            {
              timestamp: "2024-01-01T00:00:00.000Z",
              level: "error",
              message: "Boom",
              context: { command: "ping", userId: "user-1", latencyMs: 123 },
            },
          ]),
        },
      },
    } as unknown as CommandContext;

    await logsCommand.execute(interaction, context);

    expect(context.services.logs.getRecentEntries).toHaveBeenCalledWith({
      limit: 3,
      level: "error",
      guildId: "guild-1",
      userId: undefined,
      command: "ping",
      correlationId: "abc",
    });
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toBe("Recent logs");
    expect(embed.description).toContain("Boom");
    expect(embed.description).toContain("123ms");
  });

  it("handles empty results", async () => {
    const interaction = createInteraction({
      level: null,
      command: null,
      correlation: null,
      limit: null,
    });
    const context = {
      services: {
        logs: {
          getRecentEntries: jest.fn().mockResolvedValue([]),
        },
      },
    } as unknown as CommandContext;

    await logsCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "No log entries found for the selected filters."
    );
  });

  it("adds a filter footer when user filter is provided", async () => {
    const interaction = createInteraction({
      level: "info",
      command: "logs",
      correlation: "corr-1",
      limit: 2,
      user: { id: "user-9", username: "Coder" },
    });
    const context = {
      services: {
        logs: {
          getRecentEntries: jest.fn().mockResolvedValue([
            {
              timestamp: "2024-01-01T00:00:00.000Z",
              level: "info",
              message: "Hello",
              context: { command: "logs", userId: "user-9" },
            },
          ]),
        },
      },
    } as unknown as CommandContext;

    await logsCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const footerText = payload.embeds[0].data.footer?.text ?? "";
    expect(footerText).toContain("user: Coder");
    expect(footerText).toContain("correlation: corr-1");
  });
});
