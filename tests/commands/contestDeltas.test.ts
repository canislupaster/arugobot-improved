import type { ChatInputCommandInteraction } from "discord.js";

import { contestDeltasCommand } from "../../src/commands/contestDeltas.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    guild: {
      id: "guild-1",
      members: {
        fetch: jest.fn().mockResolvedValue(
          new Map([
            ["user-1", { user: { id: "user-1" } }],
            ["user-2", { user: { id: "user-2" } }],
          ])
        ),
        cache: new Map([
          ["user-1", { user: { id: "user-1" } }],
          ["user-2", { user: { id: "user-2" } }],
        ]),
      },
    },
    user: { id: "user-1" },
    options: {
      getInteger: jest.fn().mockReturnValue(null),
      getString: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("contestDeltasCommand", () => {
  it("renders rating change summary", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-1",
      services: {
        store: {
          getServerRoster: jest
            .fn()
            .mockResolvedValue([
              { userId: "user-1", handle: "Alice" },
              { userId: "user-2", handle: "Bob" },
            ]),
        },
        contestActivity: {
          getRatingChangeSummaryForRoster: jest.fn().mockResolvedValue({
            lookbackDays: 90,
            contestCount: 4,
            participantCount: 2,
            totalDelta: 120,
            lastContestAt: Math.floor(Date.now() / 1000),
            topGainers: [
              {
                userId: "user-1",
                handle: "Alice",
                contestCount: 3,
                delta: 150,
                lastContestAt: 1,
              },
            ],
            topLosers: [
              {
                userId: "user-2",
                handle: "Bob",
                contestCount: 1,
                delta: -30,
                lastContestAt: 2,
              },
            ],
          }),
        },
      },
    } as unknown as CommandContext;

    await contestDeltasCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0];
    const fields = embed.data.fields ?? [];
    const fieldText = JSON.stringify(fields);
    expect(fieldText).toContain("Top gainers");
    expect(fieldText).toContain("Top losers");
    expect(fieldText).toContain("user-1");
    expect(fieldText).toContain("user-2");
  });

  it("passes scope selection to contest activity", async () => {
    const interaction = createInteraction({
      options: {
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue("gym"),
      },
    });
    const getRatingChangeSummaryForRoster = jest.fn().mockResolvedValue({
      lookbackDays: 90,
      contestCount: 0,
      participantCount: 0,
      totalDelta: 0,
      lastContestAt: null,
      topGainers: [],
      topLosers: [],
    });
    const context = {
      correlationId: "corr-1",
      services: {
        store: {
          getServerRoster: jest
            .fn()
            .mockResolvedValue([{ userId: "user-1", handle: "Alice" }]),
        },
        contestActivity: {
          getRatingChangeSummaryForRoster,
        },
      },
    } as unknown as CommandContext;

    await contestDeltasCommand.execute(interaction, context);

    expect(getRatingChangeSummaryForRoster).toHaveBeenCalledWith(
      [{ userId: "user-1", handle: "Alice" }],
      { lookbackDays: 90, limit: 5, scope: "gym" }
    );
  });

  it("handles empty rating changes", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-2",
      services: {
        store: {
          getServerRoster: jest.fn().mockResolvedValue([
            { userId: "user-1", handle: "Alice" },
          ]),
        },
        contestActivity: {
          getRatingChangeSummaryForRoster: jest.fn().mockResolvedValue({
            lookbackDays: 90,
            contestCount: 0,
            participantCount: 0,
            totalDelta: 0,
            lastContestAt: null,
            topGainers: [],
            topLosers: [],
          }),
        },
      },
    } as unknown as CommandContext;

    await contestDeltasCommand.execute(interaction, context);

    expect((interaction.editReply as jest.Mock).mock.calls[0][0]).toContain(
      "No rating changes"
    );
  });

  it("replies when no handles are linked", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-3",
      services: {
        store: {
          getServerRoster: jest.fn().mockResolvedValue([]),
        },
        contestActivity: {
          getRatingChangeSummaryForRoster: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestDeltasCommand.execute(interaction, context);

    expect((interaction.editReply as jest.Mock).mock.calls[0][0]).toContain(
      "No linked handles"
    );
    expect(
      (context.services.contestActivity.getRatingChangeSummaryForRoster as jest.Mock)
    ).not.toHaveBeenCalled();
  });

  it("replies when no linked handles are in the guild", async () => {
    const interaction = createInteraction({
      guild: {
        id: "guild-1",
        members: {
          fetch: jest.fn().mockResolvedValue(new Map()),
          cache: new Map(),
        },
      },
    });
    const context = {
      correlationId: "corr-4",
      services: {
        store: {
          getServerRoster: jest.fn().mockResolvedValue([
            { userId: "user-1", handle: "Alice" },
          ]),
        },
        contestActivity: {
          getRatingChangeSummaryForRoster: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestDeltasCommand.execute(interaction, context);

    expect((interaction.editReply as jest.Mock).mock.calls[0][0]).toContain(
      "No linked handles found"
    );
    expect(
      (context.services.contestActivity.getRatingChangeSummaryForRoster as jest.Mock)
    ).not.toHaveBeenCalled();
  });

  it("rejects invalid lookback windows", async () => {
    const interaction = createInteraction({
      options: {
        getInteger: jest.fn((name: string) => (name === "days" ? 0 : null)),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const context = {} as CommandContext;

    await contestDeltasCommand.execute(interaction, context);

    expect((interaction.reply as jest.Mock).mock.calls[0][0]).toEqual({
      content: "Invalid lookback window.",
    });
  });

  it("rejects invalid limit", async () => {
    const interaction = createInteraction({
      options: {
        getInteger: jest.fn((name: string) => (name === "limit" ? 99 : null)),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const context = {} as CommandContext;

    await contestDeltasCommand.execute(interaction, context);

    expect((interaction.reply as jest.Mock).mock.calls[0][0]).toEqual({
      content: "Invalid limit.",
    });
  });
});
