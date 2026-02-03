import type { ChatInputCommandInteraction } from "discord.js";

import { contestActivityCommand } from "../../src/commands/contestActivity.js";
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

describe("contestActivityCommand", () => {
  it("renders contest activity summary", async () => {
    const interaction = createInteraction();
    const context = {
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
          getContestActivityForRoster: jest.fn().mockResolvedValue({
            lookbackDays: 90,
            contestCount: 2,
            participantCount: 2,
            topContests: [
              {
                contestId: 1000,
                contestName: "Contest A",
                participantCount: 2,
                ratingUpdateTimeSeconds: Math.floor(Date.now() / 1000),
                scope: "official",
              },
            ],
            recentContests: [
              {
                contestId: 1000,
                contestName: "Contest A",
                ratingUpdateTimeSeconds: Math.floor(Date.now() / 1000),
                scope: "official",
              },
            ],
            byScope: {
              official: { contestCount: 2, participantCount: 2, lastContestAt: 1 },
              gym: { contestCount: 0, participantCount: 0, lastContestAt: null },
            },
            participants: [
              {
                userId: "user-1",
                handle: "Alice",
                contestCount: 2,
                officialCount: 1,
                gymCount: 1,
                lastContestAt: 1,
              },
              {
                userId: "user-2",
                handle: "Bob",
                contestCount: 1,
                officialCount: 1,
                gymCount: 0,
                lastContestAt: 2,
              },
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
    expect(fieldText).toContain("Top contests");
    expect(fieldText).toContain("user-1");
    expect(fieldText).toContain("Contest A");
  });

  it("filters contest activity by scope", async () => {
    const interaction = createInteraction({
      options: {
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn((name: string) => (name === "scope" ? "official" : null)),
      },
    });
    const context = {
      services: {
        store: {
          getServerRoster: jest
            .fn()
            .mockResolvedValue([{ userId: "user-1", handle: "Alice" }]),
        },
        contestActivity: {
          getContestActivityForRoster: jest.fn().mockResolvedValue({
            lookbackDays: 90,
            contestCount: 2,
            participantCount: 2,
            topContests: [
              {
                contestId: 1000,
                contestName: "Contest A",
                participantCount: 1,
                ratingUpdateTimeSeconds: Math.floor(Date.now() / 1000),
                scope: "official",
              },
              {
                contestId: 1001,
                contestName: "Contest B",
                participantCount: 1,
                ratingUpdateTimeSeconds: Math.floor(Date.now() / 1000),
                scope: "gym",
              },
            ],
            recentContests: [
              {
                contestId: 1000,
                contestName: "Contest A",
                ratingUpdateTimeSeconds: Math.floor(Date.now() / 1000),
                scope: "official",
              },
              {
                contestId: 1001,
                contestName: "Contest B",
                ratingUpdateTimeSeconds: Math.floor(Date.now() / 1000),
                scope: "gym",
              },
            ],
            byScope: {
              official: { contestCount: 1, participantCount: 1, lastContestAt: 1 },
              gym: { contestCount: 1, participantCount: 1, lastContestAt: 2 },
            },
            participants: [
              {
                userId: "user-1",
                handle: "Alice",
                contestCount: 2,
                officialCount: 1,
                gymCount: 1,
                lastContestAt: 1,
              },
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
    expect(fieldText).toContain("Contest A");
    expect(fieldText).not.toContain("Contest B");
  });

  it("handles empty activity windows", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        store: {
          getServerRoster: jest.fn().mockResolvedValue([{ userId: "user-1", handle: "Alice" }]),
        },
        contestActivity: {
          getContestActivityForRoster: jest.fn().mockResolvedValue({
            lookbackDays: 90,
            contestCount: 0,
            participantCount: 0,
            topContests: [],
            recentContests: [],
            byScope: {
              official: { contestCount: 0, participantCount: 0, lastContestAt: null },
              gym: { contestCount: 0, participantCount: 0, lastContestAt: null },
            },
            participants: [],
          }),
        },
      },
    } as unknown as CommandContext;

    await contestActivityCommand.execute(interaction, context);

    expect((interaction.editReply as jest.Mock).mock.calls[0][0]).toContain("No contest activity");
  });

  it("reports when no linked handles exist", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        store: {
          getServerRoster: jest.fn().mockResolvedValue([]),
        },
        contestActivity: {
          getContestActivityForRoster: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestActivityCommand.execute(interaction, context);

    expect((interaction.editReply as jest.Mock).mock.calls[0][0]).toContain(
      "No linked handles yet."
    );
    expect(context.services.contestActivity.getContestActivityForRoster).not.toHaveBeenCalled();
  });

  it("reports when no current members have linked handles", async () => {
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
      services: {
        store: {
          getServerRoster: jest
            .fn()
            .mockResolvedValue([{ userId: "user-1", handle: "Alice" }]),
        },
        contestActivity: {
          getContestActivityForRoster: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestActivityCommand.execute(interaction, context);

    expect((interaction.editReply as jest.Mock).mock.calls[0][0]).toContain(
      "No linked handles found for current server members."
    );
    expect(context.services.contestActivity.getContestActivityForRoster).not.toHaveBeenCalled();
  });
});
