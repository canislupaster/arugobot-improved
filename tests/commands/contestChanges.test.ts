import type { ChatInputCommandInteraction } from "discord.js";

import { contestChangesCommand } from "../../src/commands/contestChanges.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (query: string, handles?: string, scope?: string) =>
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

describe("contestChangesCommand", () => {
  it("renders rating changes for linked users", async () => {
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
        contestRatingChanges: {
          getContestRatingChanges: jest.fn().mockResolvedValue({
            changes: [
              {
                contestId: 1234,
                contestName: "Codeforces Round #1234",
                handle: "tourist",
                rank: 1,
                oldRating: 3500,
                newRating: 3510,
                ratingUpdateTimeSeconds: 1_700_000_000,
              },
              {
                contestId: 1234,
                contestName: "Codeforces Round #1234",
                handle: "petr",
                rank: 2,
                oldRating: 3400,
                newRating: 3395,
                ratingUpdateTimeSeconds: 1_700_000_000,
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestChangesCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toContain("Contest rating changes");
    const changesField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Rating changes"
    );
    expect(changesField?.value).toContain("tourist");
    expect(changesField?.value).toContain("petr");
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
        contestRatingChanges: {
          getContestRatingChanges: jest.fn().mockResolvedValue({
            changes: [
              {
                contestId: 4321,
                contestName: "Codeforces Round #4321",
                handle: "tourist",
                rank: 1,
                oldRating: 3500,
                newRating: 3510,
                ratingUpdateTimeSeconds: 1_700_100_000,
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestChangesCommand.execute(interaction, context);

    expect(context.services.contests.getLatestFinished).toHaveBeenCalled();
    expect(context.services.contests.getContestById).not.toHaveBeenCalled();
    expect(context.services.contests.searchContests).not.toHaveBeenCalled();
  });

  it("warns when the contest is a gym contest", async () => {
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
        contestRatingChanges: {
          getContestRatingChanges: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestChangesCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const changesField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Rating changes"
    );
    expect(changesField?.value).toContain("not available for gym contests");
    expect(context.services.contestRatingChanges.getContestRatingChanges).not.toHaveBeenCalled();
  });

  it("warns when the contest is not finished", async () => {
    const interaction = createInteraction("1234");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Round #1234",
            phase: "CODING",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
        store: {
          getLinkedUsers: jest.fn(),
          getHandle: jest.fn(),
          resolveHandle: jest.fn(),
        },
        contestRatingChanges: {
          getContestRatingChanges: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestChangesCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const changesField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Rating changes"
    );
    expect(changesField?.value).toContain("only available once the contest is finished");
    expect(context.services.contestRatingChanges.getContestRatingChanges).not.toHaveBeenCalled();
  });
});
