import type { ChatInputCommandInteraction } from "discord.js";

import { activityCommand } from "../../src/commands/activity.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    guild: { id: "guild-1" },
    options: {
      getInteger: jest.fn().mockReturnValue(7),
      getUser: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("activityCommand", () => {
  it("shows server activity summaries", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        store: {
          getChallengeActivity: jest.fn().mockResolvedValue({
            completedChallenges: 3,
            participantCount: 6,
            uniqueParticipants: 4,
            solvedCount: 5,
            topSolvers: [
              { userId: "user-1", solvedCount: 2 },
              { userId: "user-2", solvedCount: 2 },
            ],
          }),
        },
      },
    } as unknown as CommandContext;

    await activityCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0];
    const fields = embed.data.fields ?? [];
    const fieldText = JSON.stringify(fields);
    expect(fieldText).toContain("Completed challenges");
    expect(fieldText).toContain("Participants");
    expect(fieldText).toContain("Top solvers");
    expect(fieldText).toContain("user-1");
  });

  it("shows user activity summaries", async () => {
    const interaction = createInteraction({
      options: {
        getInteger: jest.fn().mockReturnValue(14),
        getUser: jest.fn().mockReturnValue({ id: "user-1" }),
      },
    });
    const context = {
      services: {
        store: {
          getUserChallengeActivity: jest.fn().mockResolvedValue({
            participations: 2,
            solvedCount: 1,
            lastCompletedAt: new Date().toISOString(),
          }),
        },
      },
    } as unknown as CommandContext;

    await activityCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0];
    const fields = embed.data.fields ?? [];
    const fieldText = JSON.stringify(fields);
    expect(fieldText).toContain("Participations");
    expect(fieldText).toContain("Solved");
  });
});
