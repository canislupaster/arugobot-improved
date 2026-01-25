import type { ChatInputCommandInteraction } from "discord.js";

import { streakCommand } from "../../src/commands/streak.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    guild: { id: "guild-1" },
    options: {
      getUser: jest.fn().mockReturnValue(null),
      getMember: jest.fn().mockReturnValue(null),
    },
    user: { id: "user-1", username: "User One", toString: () => "<@user-1>" },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("streakCommand", () => {
  it("handles missing streak data", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        store: {
          getChallengeStreak: jest.fn().mockResolvedValue({
            currentStreak: 0,
            longestStreak: 0,
            totalSolvedDays: 0,
            lastSolvedAt: null,
          }),
        },
      },
    } as unknown as CommandContext;

    await streakCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "No completed challenges yet for <@user-1>."
    );
  });

  it("renders streak details", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        store: {
          getChallengeStreak: jest.fn().mockResolvedValue({
            currentStreak: 2,
            longestStreak: 5,
            totalSolvedDays: 7,
            lastSolvedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
          }),
        },
      },
    } as unknown as CommandContext;

    await streakCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0];
    const fields = embed.data.fields ?? [];
    const fieldText = JSON.stringify(fields);
    expect(fieldText).toContain("Current streak");
    expect(fieldText).toContain("Longest streak");
    expect(fieldText).toContain("Active days");
  });
});
