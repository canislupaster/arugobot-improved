import type { ChatInputCommandInteraction } from "discord.js";

import { statsCommand } from "../../src/commands/stats.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "stats",
    guild: { id: "guild-1" },
    user: { id: "user-1" },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

const createContext = (overrides: Record<string, unknown> = {}) =>
  ({
    services: {
      store: {
        getServerStats: jest.fn().mockResolvedValue({
          userCount: 1,
          totalChallenges: 4,
          avgRating: 1200,
          topRating: 1500,
        }),
      },
      challenges: {
        getActiveCountForServer: jest.fn().mockResolvedValue(2),
      },
      tournaments: {
        getActiveCountForGuild: jest.fn().mockResolvedValue(1),
      },
    },
    ...overrides,
  }) as unknown as CommandContext;

describe("statsCommand", () => {
  it("rejects DMs", async () => {
    const interaction = createInteraction({ guild: null });
    const context = createContext();

    await statsCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "This command can only be used in a server.",
    });
  });

  it("handles empty server stats", async () => {
    const interaction = createInteraction();
    const context = createContext({
      services: {
        store: {
          getServerStats: jest.fn().mockResolvedValue({
            userCount: 0,
            totalChallenges: 0,
            avgRating: null,
            topRating: null,
          }),
        },
        challenges: {
          getActiveCountForServer: jest.fn().mockResolvedValue(0),
        },
        tournaments: {
          getActiveCountForGuild: jest.fn().mockResolvedValue(0),
        },
      },
    });

    await statsCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("No linked users yet.");
  });

  it("renders server stats with active counts", async () => {
    const interaction = createInteraction();
    const context = createContext();

    await statsCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0];
    const fields = embed.data.fields ?? [];
    const fieldText = JSON.stringify(fields);
    expect(fieldText).toContain("Active challenges");
    expect(fieldText).toContain("Active tournaments");
    expect(fieldText).toContain("Average rating");
  });

  it("handles service errors", async () => {
    const interaction = createInteraction();
    const context = createContext({
      services: {
        store: {
          getServerStats: jest.fn().mockRejectedValue(new Error("boom")),
        },
        challenges: {
          getActiveCountForServer: jest.fn().mockResolvedValue(0),
        },
        tournaments: {
          getActiveCountForGuild: jest.fn().mockResolvedValue(0),
        },
      },
    });

    await statsCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Something went wrong.");
  });
});
