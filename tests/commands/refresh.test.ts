import type { ChatInputCommandInteraction } from "discord.js";

import { refreshCommand } from "../../src/commands/refresh.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "refresh",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getString: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("refreshCommand", () => {
  it("refreshes all scopes by default", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-1",
      services: {
        problems: {
          refreshProblems: jest.fn().mockResolvedValue(undefined),
          getProblems: jest.fn().mockReturnValue(new Array(3)),
        },
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getUpcomingContests: jest.fn().mockReturnValue([{ id: 1 }]),
          getOngoing: jest.fn().mockReturnValue([]),
        },
        store: {
          refreshHandles: jest.fn().mockResolvedValue({ checked: 2, updated: 1 }),
        },
      },
    } as unknown as CommandContext;

    await refreshCommand.execute(interaction, context);

    expect(context.services.problems.refreshProblems).toHaveBeenCalledWith(true);
    expect(context.services.contests.refresh).toHaveBeenCalledWith(true);
    expect(context.services.store.refreshHandles).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it("refreshes a single scope when specified", async () => {
    const interaction = createInteraction({
      options: { getString: jest.fn().mockReturnValue("handles") },
    });
    const context = {
      correlationId: "corr-2",
      services: {
        problems: {
          refreshProblems: jest.fn(),
          getProblems: jest.fn(),
        },
        contests: {
          refresh: jest.fn(),
          getUpcomingContests: jest.fn(),
          getOngoing: jest.fn(),
        },
        store: {
          refreshHandles: jest.fn().mockResolvedValue({ checked: 1, updated: 0 }),
        },
      },
    } as unknown as CommandContext;

    await refreshCommand.execute(interaction, context);

    expect(context.services.store.refreshHandles).toHaveBeenCalled();
    expect(context.services.problems.refreshProblems).not.toHaveBeenCalled();
    expect(context.services.contests.refresh).not.toHaveBeenCalled();
  });
});
