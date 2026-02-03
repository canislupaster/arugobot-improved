import type { ChatInputCommandInteraction } from "discord.js";

import { profileCommand } from "../../src/commands/profile.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "profile",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getString: jest.fn().mockReturnValue("tourist"),
      getUser: jest.fn().mockReturnValue(null),
      getMember: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

type RatingChange = {
  contestId: number;
  contestName: string;
  rank: number;
  oldRating: number;
  newRating: number;
  ratingUpdateTimeSeconds: number;
};

const createRatingChangesService = (changes: RatingChange[] = []) => ({
  getRatingChanges: jest.fn().mockResolvedValue({
    changes,
    source: "api",
    isStale: false,
  }),
});

describe("profileCommand", () => {
  it("renders a profile for a linked handle", async () => {
    const interaction = createInteraction();
    const ratingChanges = createRatingChangesService([
      {
        contestId: 1000,
        contestName: "Codeforces Round #1000",
        rank: 10,
        oldRating: 3600,
        newRating: 3650,
        ratingUpdateTimeSeconds: 2000,
      },
    ]);
    const context = {
      correlationId: "corr-1",
      services: {
        ratingChanges,
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Tourist",
            source: "api",
          }),
          getUserIdByHandle: jest.fn().mockResolvedValue("user-2"),
          getCodeforcesProfile: jest.fn().mockResolvedValue({
            profile: {
              handle: "tourist",
              displayHandle: "Tourist",
              rating: 3700,
              rank: "legendary grandmaster",
              maxRating: 3800,
              maxRank: "legendary grandmaster",
              lastOnlineTimeSeconds: 123,
              lastFetched: new Date().toISOString(),
            },
            source: "cache",
            isStale: false,
          }),
          getRating: jest.fn().mockResolvedValue(1600),
          getChallengeHistoryPage: jest.fn().mockResolvedValue({
            total: 1,
            entries: [
              {
                challengeId: "challenge-1",
                problemId: "1000A",
                contestId: 1000,
                index: "A",
                name: "Test Problem",
                rating: 1200,
                startedAt: 1000,
                endsAt: 2000,
                solvedAt: 1500,
                ratingDelta: 25,
              },
            ],
          }),
          getChallengeStreak: jest.fn().mockResolvedValue({
            currentStreak: 2,
            longestStreak: 5,
            totalSolvedDays: 8,
            lastSolvedAt: new Date().toISOString(),
          }),
          getHistoryWithRatings: jest.fn(),
          getRecentSubmissions: jest.fn().mockResolvedValue({
            submissions: [
              {
                id: 1,
                contestId: 1000,
                index: "A",
                name: "Test Problem",
                verdict: "OK",
                creationTimeSeconds: 1000,
                programmingLanguage: "GNU C++17",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
        problems: {
          getProblemDict: jest.fn().mockReturnValue(new Map()),
        },
      },
    } as unknown as CommandContext;

    await profileCommand.execute(interaction, context);

    expect(ratingChanges.getRatingChanges).toHaveBeenCalledWith("Tourist");
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(context.services.store.getChallengeStreak).toHaveBeenCalledWith("guild-1", "user-2");
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );

    const replyPayload = (interaction.editReply as jest.Mock).mock.calls[0]?.[0];
    const embed = replyPayload?.embeds?.[0];
    const fields = embed?.data?.fields ?? [];
    expect(fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Challenge streak" })])
    );
  });

  it("renders a profile for an unlinked handle with recent submissions", async () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn().mockReturnValue("tourist"),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
      },
    });
    const ratingChanges = createRatingChangesService([]);
    const context = {
      correlationId: "corr-2",
      services: {
        ratingChanges,
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Tourist",
            source: "api",
          }),
          getUserIdByHandle: jest.fn().mockResolvedValue(null),
          getCodeforcesProfile: jest.fn().mockResolvedValue({
            profile: {
              handle: "tourist",
              displayHandle: "Tourist",
              rating: 2500,
              rank: "grandmaster",
              maxRating: 2600,
              maxRank: "grandmaster",
              lastOnlineTimeSeconds: 123,
              lastFetched: new Date().toISOString(),
            },
            source: "api",
            isStale: false,
          }),
          getRecentSubmissions: jest.fn().mockResolvedValue({
            submissions: [
              {
                id: 2,
                contestId: 1001,
                index: "B",
                name: "Another Problem",
                verdict: "WRONG_ANSWER",
                creationTimeSeconds: 1200,
                programmingLanguage: "GNU C++17",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await profileCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(context.services.store.getRecentSubmissions).toHaveBeenCalledWith("Tourist", 5);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it("rejects invalid handles", async () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn().mockReturnValue("unknown"),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-3",
      services: {
        ratingChanges: createRatingChangesService([]),
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: false,
            canonicalHandle: null,
            source: "api",
          }),
        },
      },
    } as unknown as CommandContext;

    await profileCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith("Invalid handle.");
  });

  it("rejects handle and user together", async () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn().mockReturnValue("tourist"),
        getUser: jest.fn().mockReturnValue({ id: "user-2", username: "Other" }),
        getMember: jest.fn().mockReturnValue(null),
      },
    });
    const context = { correlationId: "corr-4", services: {} } as unknown as CommandContext;

    await profileCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Provide either a handle or a user, not both.",
      })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it("requires a handle in DMs", async () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn().mockReturnValue(""),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
      },
      guild: null,
    });
    const context = { correlationId: "corr-5", services: {} } as unknown as CommandContext;

    await profileCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Provide a handle when using this command in DMs.",
      })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it("supports handles in DMs", async () => {
    const interaction = createInteraction({
      guild: null,
      options: {
        getString: jest.fn().mockReturnValue("tourist"),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
      },
    });
    const ratingChanges = createRatingChangesService([
      {
        contestId: 1002,
        contestName: "Codeforces Round #1002",
        rank: 50,
        oldRating: 2400,
        newRating: 2450,
        ratingUpdateTimeSeconds: 3000,
      },
    ]);
    const context = {
      correlationId: "corr-6",
      services: {
        ratingChanges,
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Tourist",
            source: "api",
          }),
          getCodeforcesProfile: jest.fn().mockResolvedValue({
            profile: {
              handle: "tourist",
              displayHandle: "Tourist",
              rating: 2500,
              rank: "grandmaster",
              maxRating: 2600,
              maxRank: "grandmaster",
              lastOnlineTimeSeconds: 123,
              lastFetched: new Date().toISOString(),
            },
            source: "api",
            isStale: false,
          }),
          getRecentSubmissions: jest.fn().mockResolvedValue({
            submissions: [
              {
                id: 2,
                contestId: 1001,
                index: "B",
                name: "Another Problem",
                verdict: "WRONG_ANSWER",
                creationTimeSeconds: 1200,
                programmingLanguage: "GNU C++17",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await profileCommand.execute(interaction, context);

    expect(ratingChanges.getRatingChanges).toHaveBeenCalledWith("Tourist");
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });
});
