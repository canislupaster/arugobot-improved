import type { ChatInputCommandInteraction } from "discord.js";

import { logsCommand } from "../../src/commands/logs.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (options: {
  level?: string | null;
  command?: string | null;
  limit?: number | null;
}) =>
  ({
    guild: { id: "guild-1" },
    options: {
      getInteger: jest.fn(() => options.limit ?? null),
      getString: jest.fn((name: string) =>
        name === "level" ? (options.level ?? null) : (options.command ?? null)
      ),
      getUser: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("logsCommand", () => {
  it("renders recent log entries", async () => {
    const interaction = createInteraction({ level: "error", command: "ping", limit: 3 });
    const context = {
      services: {
        logs: {
          getRecentEntries: jest.fn().mockResolvedValue([
            {
              timestamp: "2024-01-01T00:00:00.000Z",
              level: "error",
              message: "Boom",
              context: { command: "ping", userId: "user-1" },
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
    });
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toBe("Recent logs");
    expect(embed.description).toContain("Boom");
  });

  it("handles empty results", async () => {
    const interaction = createInteraction({ level: null, command: null, limit: null });
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
});
