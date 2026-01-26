import type { ChatInputCommandInteraction } from "discord.js";

import { contestResultsCommand } from "../../src/commands/contestResults.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (
  query: string,
  handles?: string,
  scope?: string,
  includePractice?: boolean
) =>
  ({
    options: {
      getString: jest.fn((name: string) => {
        if (name === "query") {
          return query;
        }
        if (name === "handles") {
          return handles ?? null;
        }
        if (name === "scope") {
          return scope ?? null;
        }
        return null;
      }),
      getInteger: jest.fn().mockReturnValue(null),
      getBoolean: jest.fn((name: string) => {
        if (name === "include_practice") {
          return includePractice ?? null;
        }
        return null;
      }),
      getUser: jest.fn().mockReturnValue(null),
    },
    user: { id: "user-1" },
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
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("contestResultsCommand", () => {
  it("renders standings for linked users", async () => {
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
        store: {
          getLinkedUsers: jest.fn().mockResolvedValue([
            { userId: "user-1", handle: "tourist" },
            { userId: "user-2", handle: "petr" },
          ]),
          getHandle: jest.fn(),
          resolveHandle: jest.fn(),
        },
        contestStandings: {
          getStandings: jest.fn().mockResolvedValue({
            entries: [
              {
                handle: "tourist",
                rank: 1,
                points: 100,
                penalty: 0,
                participantType: "CONTESTANT",
              },
              {
                handle: "petr",
                rank: 2,
                points: 95,
                penalty: 10,
                participantType: "VIRTUAL",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestResultsCommand.execute(interaction, context);

    expect(context.services.contestStandings.getStandings).toHaveBeenCalledWith(
      1234,
      expect.arrayContaining(["tourist", "petr"]),
      "FINISHED",
      false
    );
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toContain("Contest results");
    const standingsField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Standings"
    );
    expect(standingsField?.value).toContain("tourist");
    expect(standingsField?.value).toContain("petr");
  });

  it("filters practice results by default", async () => {
    const interaction = createInteraction("1234", "tourist,practice");
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
        store: {
          resolveHandle: jest.fn().mockResolvedValue({ exists: true, canonicalHandle: null }),
        },
        contestStandings: {
          getStandings: jest.fn().mockResolvedValue({
            entries: [
              {
                handle: "tourist",
                rank: 1,
                points: 100,
                penalty: 0,
                participantType: "CONTESTANT",
              },
              {
                handle: "practice",
                rank: 0,
                points: 1,
                penalty: 99,
                participantType: "PRACTICE",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestResultsCommand.execute(interaction, context);

    expect(context.services.contestStandings.getStandings).toHaveBeenCalledWith(
      1234,
      expect.arrayContaining(["tourist", "practice"]),
      "FINISHED",
      false
    );
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const standingsField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Standings"
    );
    expect(standingsField?.value).toContain("tourist");
    expect(standingsField?.value).not.toContain("practice");
  });

  it("includes practice results when requested", async () => {
    const interaction = createInteraction("1234", "tourist,practice", undefined, true);
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
        store: {
          resolveHandle: jest.fn().mockResolvedValue({ exists: true, canonicalHandle: null }),
        },
        contestStandings: {
          getStandings: jest.fn().mockResolvedValue({
            entries: [
              {
                handle: "tourist",
                rank: 1,
                points: 100,
                penalty: 0,
                participantType: "CONTESTANT",
              },
              {
                handle: "practice",
                rank: 0,
                points: 1,
                penalty: 99,
                participantType: "PRACTICE",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestResultsCommand.execute(interaction, context);

    expect(context.services.contestStandings.getStandings).toHaveBeenCalledWith(
      1234,
      expect.arrayContaining(["tourist", "practice"]),
      "FINISHED",
      true
    );
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const standingsField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Standings"
    );
    expect(standingsField?.value).toContain("practice");
  });

  it("uses the latest finished contest when requested", async () => {
    const interaction = createInteraction("latest");
    const latestContest = {
      id: 4321,
      name: "Codeforces Round #4321",
      phase: "FINISHED",
      startTimeSeconds: 1_700_100_000,
      durationSeconds: 7200,
    };
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getLatestFinished: jest.fn().mockReturnValue(latestContest),
          getContestById: jest.fn(),
          searchContests: jest.fn(),
        },
        store: {
          getLinkedUsers: jest.fn().mockResolvedValue([{ userId: "user-1", handle: "tourist" }]),
          getHandle: jest.fn(),
          resolveHandle: jest.fn(),
        },
        contestStandings: {
          getStandings: jest.fn().mockResolvedValue({
            entries: [
              {
                handle: "tourist",
                rank: 1,
                points: 100,
                penalty: 0,
                participantType: "CONTESTANT",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestResultsCommand.execute(interaction, context);

    expect(context.services.contests.getLatestFinished).toHaveBeenCalled();
    expect(context.services.contests.getContestById).not.toHaveBeenCalled();
    expect(context.services.contests.searchContests).not.toHaveBeenCalled();
  });

  it("supports gym scope", async () => {
    const interaction = createInteraction("1234", "tourist", "gym");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Gym Contest",
            phase: "FINISHED",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
            isGym: true,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
        store: {
          resolveHandle: jest.fn().mockResolvedValue({ exists: true, canonicalHandle: "tourist" }),
        },
        contestStandings: {
          getStandings: jest.fn().mockResolvedValue({
            entries: [
              {
                handle: "tourist",
                rank: 1,
                points: 100,
                penalty: 0,
                participantType: "CONTESTANT",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestResultsCommand.execute(interaction, context);

    expect(context.services.contests.refresh).toHaveBeenCalledWith(false, "gym");
    expect(context.services.contests.getContestById).toHaveBeenCalledWith(1234, "gym");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.fields?.some((field: { name: string }) => field.name === "Section")).toBe(true);
  });

  it("lists contest matches when multiple contests are found", async () => {
    const interaction = createInteraction("Div. 2", "tourist");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue(null),
          searchContests: jest.fn().mockReturnValue([
            {
              id: 900,
              name: "Codeforces Round #900 (Div. 2)",
              phase: "BEFORE",
              startTimeSeconds: 1_700_000_000,
              durationSeconds: 7200,
            },
            {
              id: 850,
              name: "Codeforces Round #850 (Div. 2)",
              phase: "FINISHED",
              startTimeSeconds: 1_600_000_000,
              durationSeconds: 7200,
            },
          ]),
        },
        store: {
          resolveHandle: jest.fn().mockResolvedValue({ exists: true, canonicalHandle: "tourist" }),
        },
        contestStandings: {
          getStandings: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestResultsCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Contest matches");
    expect(context.services.contestStandings.getStandings).not.toHaveBeenCalled();
  });
});
