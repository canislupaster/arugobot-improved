import type { ChatInputCommandInteraction } from "discord.js";

import { contestSolvesCommand } from "../../src/commands/contestSolves.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (
  query: string,
  options: { scope?: string; limit?: number; handles?: string; guild?: boolean } = {}
) =>
  ({
    commandName: "contestsolves",
    options: {
      getString: jest.fn((name: string) => {
        if (name === "query") {
          return query;
        }
        if (name === "scope") {
          return options.scope ?? null;
        }
        if (name === "handles") {
          return options.handles ?? null;
        }
        return null;
      }),
      getInteger: jest.fn((name: string) => {
        if (name === "limit") {
          return options.limit ?? null;
        }
        return null;
      }),
      getUser: jest.fn(() => null),
    },
    user: { id: "user-1" },
    guild:
      options.guild === false
        ? null
        : {
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
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("contestSolvesCommand", () => {
  it("renders unsolved and solved problem lists", async () => {
    const interaction = createInteraction("1234");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Round #1234",
            phase: "FINISHED",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([
            {
              contestId: 1234,
              index: "A",
              name: "Problem A",
              rating: 800,
              tags: [],
            },
            {
              contestId: 1234,
              index: "B",
              name: "Problem B",
              rating: 900,
              tags: [],
            },
          ]),
        },
        store: {
          getLinkedUsers: jest.fn().mockResolvedValue([
            { userId: "user-1", handle: "tourist" },
            { userId: "user-2", handle: "petr" },
          ]),
          getContestSolvesResult: jest.fn().mockResolvedValue({
            solves: [
              {
                id: 1,
                handle: "tourist",
                contestId: 1234,
                index: "A",
                creationTimeSeconds: 1_700_000_100,
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestSolvesCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const unsolvedField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Unsolved problems"
    );
    const solvedField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Solved problems"
    );
    expect(unsolvedField?.value).toContain("Problem B");
    expect(solvedField?.value).toContain("Problem A");
  });

  it("returns a message when no linked handles exist", async () => {
    const interaction = createInteraction("1234");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Round #1234",
            phase: "FINISHED",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([
            {
              contestId: 1234,
              index: "A",
              name: "Problem A",
              rating: 800,
              tags: [],
            },
          ]),
        },
        store: {
          getLinkedUsers: jest.fn().mockResolvedValue([]),
          getContestSolvesResult: jest.fn().mockResolvedValue({
            solves: [],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestSolvesCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "No linked handles found in this server yet."
    );
  });

  it("returns a message when contest solves cache is missing", async () => {
    const interaction = createInteraction("1234");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Round #1234",
            phase: "FINISHED",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([
            {
              contestId: 1234,
              index: "A",
              name: "Problem A",
              rating: 800,
              tags: [],
            },
          ]),
        },
        store: {
          getLinkedUsers: jest.fn(),
          getContestSolvesResult: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await contestSolvesCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "Contest submissions cache not ready yet. Try again soon."
    );
    expect(context.services.store.getLinkedUsers).not.toHaveBeenCalled();
  });

  it("accepts explicit handles outside a guild", async () => {
    const interaction = createInteraction("1234", { handles: "tourist", guild: false });
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Round #1234",
            phase: "FINISHED",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([
            {
              contestId: 1234,
              index: "A",
              name: "Problem A",
              rating: 800,
              tags: [],
            },
          ]),
        },
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "tourist",
          }),
          getContestSolvesResult: jest.fn().mockResolvedValue({
            solves: [],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestSolvesCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("returns a message when a handle is invalid", async () => {
    const interaction = createInteraction("1234", { handles: "unknown", guild: false });
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Round #1234",
            phase: "FINISHED",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([
            {
              contestId: 1234,
              index: "A",
              name: "Problem A",
              rating: 800,
              tags: [],
            },
          ]),
        },
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: false,
            canonicalHandle: null,
          }),
          getContestSolvesResult: jest.fn().mockResolvedValue({
            solves: [],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestSolvesCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Invalid handle: unknown");
  });
});
