import type { ChatInputCommandInteraction } from "discord.js";

import { profileCommand } from "../../src/commands/profile.js";
import type { CommandContext } from "../../src/types/commandContext.js";
import { publicFlags } from "../../src/utils/discordFlags.js";

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

describe("profileCommand", () => {
  it("renders a profile for a linked handle", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-1",
      services: {
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

    expect(interaction.deferReply).toHaveBeenCalledWith({ ...publicFlags });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
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
    const context = {
      correlationId: "corr-2",
      services: {
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

    expect(interaction.deferReply).toHaveBeenCalledWith({ ...publicFlags });
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

    expect(interaction.deferReply).toHaveBeenCalledWith({ ...publicFlags });
    expect(interaction.editReply).toHaveBeenCalledWith("Invalid handle.");
  });
});
