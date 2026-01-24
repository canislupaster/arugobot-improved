import type { ChatInputCommandInteraction } from "discord.js";

import { contestActivityCommand } from "../../src/commands/contestActivity.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    guild: { id: "guild-1" },
    options: {
      getInteger: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("contestActivityCommand", () => {
  it("renders contest activity summary", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        contestActivity: {
          getGuildContestActivity: jest.fn().mockResolvedValue({
            lookbackDays: 90,
            contestCount: 2,
            participantCount: 2,
            recentContests: [
              {
                contestId: 1000,
                contestName: "Contest A",
                ratingUpdateTimeSeconds: Math.floor(Date.now() / 1000),
              },
            ],
            participants: [
              { userId: "user-1", handle: "Alice", contestCount: 2, lastContestAt: 1 },
              { userId: "user-2", handle: "Bob", contestCount: 1, lastContestAt: 2 },
            ],
          }),
        },
      },
    } as unknown as CommandContext;

    await contestActivityCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0];
    const fields = embed.data.fields ?? [];
    const fieldText = JSON.stringify(fields);
    expect(fieldText).toContain("Top participants");
    expect(fieldText).toContain("user-1");
    expect(fieldText).toContain("Contest A");
  });

  it("handles empty activity windows", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        contestActivity: {
          getGuildContestActivity: jest.fn().mockResolvedValue({
            lookbackDays: 90,
            contestCount: 0,
            participantCount: 0,
            recentContests: [],
            participants: [],
          }),
        },
      },
    } as unknown as CommandContext;

    await contestActivityCommand.execute(interaction, context);

    expect((interaction.editReply as jest.Mock).mock.calls[0][0]).toContain(
      "No contest activity"
    );
  });
});
