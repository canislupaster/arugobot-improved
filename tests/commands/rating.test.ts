import type { ChatInputCommandInteraction } from "discord.js";

import { createRatingCommand } from "../../src/commands/rating.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "rating",
    user: { id: "user-1", username: "User", toString: () => "<@user-1>" },
    guild: { id: "guild-1" },
    options: {
      getUser: jest.fn().mockReturnValue(null),
      getMember: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

const createContext = (overrides: Record<string, unknown> = {}) =>
  ({
    correlationId: "corr-1",
    services: {
      store: {
        handleLinked: jest.fn().mockResolvedValue(true),
        getRating: jest.fn().mockResolvedValue(1400),
        getHistoryWithRatings: jest.fn().mockResolvedValue({
          history: [],
          ratingHistory: [1200, 1300],
        }),
      },
    },
    ...overrides,
  }) as unknown as CommandContext;

describe("ratingCommand", () => {
  it("rejects DMs", async () => {
    const interaction = createInteraction({ guild: null });
    const context = createContext();
    const command = createRatingCommand(jest.fn());

    await command.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "This command can only be used in a server.",
    });
  });

  it("rejects unlinked handles", async () => {
    const interaction = createInteraction();
    const context = createContext({
      services: {
        store: {
          handleLinked: jest.fn().mockResolvedValue(false),
        },
      },
    });
    const command = createRatingCommand(jest.fn());

    await command.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Handle not linked.");
  });

  it("handles empty rating history", async () => {
    const interaction = createInteraction();
    const context = createContext({
      services: {
        store: {
          handleLinked: jest.fn().mockResolvedValue(true),
          getRating: jest.fn().mockResolvedValue(1400),
          getHistoryWithRatings: jest.fn().mockResolvedValue({
            history: [],
            ratingHistory: [],
          }),
        },
      },
    });
    const command = createRatingCommand(jest.fn());

    await command.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("No rating history yet.");
  });

  it("renders the rating chart", async () => {
    const interaction = createInteraction();
    const context = createContext();
    const renderSpy = jest.fn().mockResolvedValue(Buffer.from("chart"));
    const command = createRatingCommand(renderSpy);

    await command.execute(interaction, context);

    expect(renderSpy).toHaveBeenCalledWith("User", [1200, 1300]);
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Rating graph");
  });
});
