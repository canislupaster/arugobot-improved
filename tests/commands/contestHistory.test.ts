import type { ChatInputCommandInteraction } from "discord.js";

import { contestHistoryCommand } from "../../src/commands/contestHistory.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (handle: string | null, limit: number | null) =>
  ({
    guild: { id: "guild-1" },
    user: { id: "user-1" },
    options: {
      getString: jest.fn((name: string) => (name === "handle" ? handle : null)),
      getUser: jest.fn().mockReturnValue(null),
      getInteger: jest.fn((name: string) => (name === "limit" ? limit : null)),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("contestHistoryCommand", () => {
  it("renders recent rating changes for a handle", async () => {
    const interaction = createInteraction("tourist", 2);
    const context = {
      services: {
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "tourist",
          }),
          getHandle: jest.fn(),
        },
        ratingChanges: {
          getRatingChanges: jest.fn().mockResolvedValue({
            changes: [
              {
                contestId: 1,
                contestName: "Codeforces Round #1",
                rank: 10,
                oldRating: 1500,
                newRating: 1550,
                ratingUpdateTimeSeconds: 1_700_000_000,
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestHistoryCommand.execute(interaction, context);

    expect(context.services.store.resolveHandle).toHaveBeenCalledWith("tourist");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toContain("tourist");
    expect(embed.description).toContain("Codeforces Round #1");
  });

  it("handles API failures gracefully", async () => {
    const interaction = createInteraction("tourist", null);
    const context = {
      services: {
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "tourist",
          }),
        },
        ratingChanges: {
          getRatingChanges: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await contestHistoryCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "Unable to fetch contest history right now."
    );
  });
});
