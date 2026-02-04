import type { ChatInputCommandInteraction } from "discord.js";

import { contestUpsolveCommand } from "../../src/commands/contestUpsolve.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (options: {
  query: string;
  handle?: string;
  limit?: number;
  guildId?: string | null;
}) =>
  ({
    commandName: "contestupsolve",
    options: {
      getString: jest.fn((name: string) => {
        if (name === "query") {
          return options.query;
        }
        if (name === "handle") {
          return options.handle ?? null;
        }
        if (name === "scope") {
          return null;
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
      getMember: jest.fn(() => null),
    },
    user: {
      id: "user-1",
      username: "Alice",
      toString: () => "<@user-1>",
    },
    guild: options.guildId === null ? null : { id: options.guildId ?? "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("contestUpsolveCommand", () => {
  it("renders an unsolved list for the linked handle", async () => {
    const interaction = createInteraction({ query: "1234" });
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
          getHandle: jest.fn().mockResolvedValue("tourist"),
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

    await contestUpsolveCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const unsolvedField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Unsolved problems"
    );
    expect(unsolvedField?.value).toContain("Problem B");
  });

  it("returns a message when the user has no linked handle", async () => {
    const interaction = createInteraction({ query: "1234" });
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
          getHandle: jest.fn().mockResolvedValue(null),
          getContestSolvesResult: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestUpsolveCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Handle not linked.");
  });

  it("rejects invalid handle input", async () => {
    const interaction = createInteraction({ query: "1234", handle: "bad" });
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
          ensureProblemsLoaded: jest.fn().mockResolvedValue([]),
        },
        store: {
          resolveHandle: jest.fn().mockResolvedValue({ exists: false }),
          getHandle: jest.fn(),
          getContestSolvesResult: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestUpsolveCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Invalid handle.");
  });

  it("rejects invalid limits", async () => {
    const interaction = createInteraction({ query: "1234", limit: 99 });
    const context = {
      services: {
        contests: {
          refresh: jest.fn(),
          getLastRefreshAt: jest.fn(),
          getContestById: jest.fn(),
          searchContests: jest.fn(),
        },
        problems: {
          ensureProblemsLoaded: jest.fn(),
        },
        store: {
          getHandle: jest.fn(),
          getContestSolvesResult: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestUpsolveCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({ content: "Invalid limit." });
  });

  it("returns a message when contest solves cache is missing", async () => {
    const interaction = createInteraction({ query: "1234" });
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
          getHandle: jest.fn().mockResolvedValue("tourist"),
          getContestSolvesResult: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await contestUpsolveCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "Contest submissions cache not ready yet. Try again soon."
    );
  });

  it("returns a message when contest problems are missing", async () => {
    const interaction = createInteraction({ query: "1234" });
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
          ensureProblemsLoaded: jest.fn().mockResolvedValue([]),
        },
        store: {
          getHandle: jest.fn().mockResolvedValue("tourist"),
          getContestSolvesResult: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestUpsolveCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "No contest problems found in the cache yet."
    );
  });

  it("allows handle input outside a server", async () => {
    const interaction = createInteraction({ query: "1234", handle: "tourist", guildId: null });
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
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "tourist",
          }),
          getHandle: jest.fn(),
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

    await contestUpsolveCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it("includes linked user info for handle input in a server", async () => {
    const interaction = createInteraction({ query: "1234", handle: "tourist" });
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
          getUserIdByHandle: jest.fn().mockResolvedValue("user-99"),
          getHandle: jest.fn(),
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

    await contestUpsolveCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const targetField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Target"
    );
    expect(targetField?.value).toContain("linked to <@user-99>");
  });

  it("rejects missing handles outside a server", async () => {
    const interaction = createInteraction({ query: "1234", guildId: null });
    const context = {
      services: {
        contests: {
          refresh: jest.fn(),
          getLastRefreshAt: jest.fn(),
          getContestById: jest.fn(),
          searchContests: jest.fn(),
        },
        problems: {
          ensureProblemsLoaded: jest.fn(),
        },
        store: {
          resolveHandle: jest.fn(),
          getHandle: jest.fn(),
          getContestSolvesResult: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestUpsolveCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Run this command in a server or provide a handle.",
    });
  });
});
