import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import type { CodeforcesClient } from "../../src/services/codeforces.js";
import { ContestActivityService } from "../../src/services/contestActivity.js";
import { GuildSettingsService } from "../../src/services/guildSettings.js";
import type { RatingChangesService } from "../../src/services/ratingChanges.js";
import { StoreService } from "../../src/services/store.js";
import type { TournamentRecap } from "../../src/services/tournaments.js";
import { WebsiteService } from "../../src/services/website.js";

const mockCodeforces = {
  request: jest.fn(),
  getLastError: jest.fn().mockReturnValue(null),
  getLastSuccessAt: jest.fn().mockReturnValue("2024-01-01T00:00:00.000Z"),
} as unknown as CodeforcesClient;

const mockRatingChanges = {
  getRatingChanges: jest.fn().mockResolvedValue(null),
} as unknown as RatingChangesService;

const mockTournaments = {
  getRecap: jest.fn().mockResolvedValue(null),
};

describe("WebsiteService", () => {
  let db: Kysely<Database>;
  let store: StoreService;
  let website: WebsiteService;
  let settings: GuildSettingsService;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    store = new StoreService(db, mockCodeforces);
    settings = new GuildSettingsService(db);
    const contestActivity = new ContestActivityService(db, store, mockRatingChanges);
    website = new WebsiteService(db, store, settings, contestActivity, {
      codeforces: mockCodeforces,
      tournaments: mockTournaments,
    });
    mockTournaments.getRecap.mockResolvedValue(null);

    await db
      .insertInto("users")
      .values([
        {
          server_id: "guild-1",
          user_id: "user-1",
          handle: "alice",
          rating: 1500,
          history: "[]",
          rating_history: "[]",
        },
        {
          server_id: "guild-1",
          user_id: "user-2",
          handle: "bob",
          rating: 1400,
          history: "[]",
          rating_history: "[]",
        },
        {
          server_id: "guild-2",
          user_id: "user-3",
          handle: "carol",
          rating: 2000,
          history: "[]",
          rating_history: "[]",
        },
      ])
      .execute();

    await db
      .insertInto("challenges")
      .values([
        {
          id: "ch-1",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-1",
          host_user_id: "user-1",
          problem_contest_id: 100,
          problem_index: "A",
          problem_name: "Alpha",
          problem_rating: 800,
          length_minutes: 40,
          status: "completed",
          started_at: 1,
          ends_at: 2,
          check_index: 0,
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "ch-2",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-2",
          host_user_id: "user-2",
          problem_contest_id: 200,
          problem_index: "B",
          problem_name: "Beta",
          problem_rating: 900,
          length_minutes: 40,
          status: "active",
          started_at: 3,
          ends_at: 4,
          check_index: 0,
          updated_at: "2024-01-02T00:00:00.000Z",
        },
        {
          id: "ch-3",
          server_id: "guild-2",
          channel_id: "channel-9",
          message_id: "message-3",
          host_user_id: "user-3",
          problem_contest_id: 300,
          problem_index: "C",
          problem_name: "Gamma",
          problem_rating: 1000,
          length_minutes: 40,
          status: "completed",
          started_at: 5,
          ends_at: 6,
          check_index: 0,
          updated_at: "2024-01-03T00:00:00.000Z",
        },
      ])
      .execute();

    await db
      .insertInto("challenge_participants")
      .values([
        {
          challenge_id: "ch-1",
          user_id: "user-1",
          position: 1,
          solved_at: 10,
        },
        {
          challenge_id: "ch-1",
          user_id: "user-2",
          position: 2,
          solved_at: null,
        },
        {
          challenge_id: "ch-3",
          user_id: "user-3",
          position: 1,
          solved_at: 20,
        },
      ])
      .execute();

    await db
      .insertInto("tournaments")
      .values([
        {
          id: "t-1",
          guild_id: "guild-1",
          channel_id: "channel-1",
          host_user_id: "user-1",
          format: "swiss",
          status: "completed",
          length_minutes: 60,
          round_count: 3,
          current_round: 3,
          rating_ranges: "800-1200",
          tags: "",
          updated_at: "2024-01-02T12:00:00.000Z",
        },
        {
          id: "t-2",
          guild_id: "guild-1",
          channel_id: "channel-1",
          host_user_id: "user-2",
          format: "elimination",
          status: "active",
          length_minutes: 60,
          round_count: 2,
          current_round: 1,
          rating_ranges: "800-1200",
          tags: "",
          updated_at: "2024-01-04T12:00:00.000Z",
        },
        {
          id: "t-4",
          guild_id: "guild-1",
          channel_id: "channel-2",
          host_user_id: "user-1",
          format: "arena",
          status: "active",
          length_minutes: 90,
          round_count: 5,
          current_round: 1,
          rating_ranges: "800-1200",
          tags: "",
          updated_at: "2024-01-06T12:00:00.000Z",
        },
        {
          id: "t-3",
          guild_id: "guild-2",
          channel_id: "channel-9",
          host_user_id: "user-3",
          format: "swiss",
          status: "completed",
          length_minutes: 40,
          round_count: 2,
          current_round: 2,
          rating_ranges: "800-1200",
          tags: "",
          updated_at: "2024-01-05T12:00:00.000Z",
        },
      ])
      .execute();

    await db
      .insertInto("tournament_arena_state")
      .values({
        tournament_id: "t-4",
        starts_at: 1700000000,
        ends_at: 1700005400,
        problem_count: 5,
        created_at: "2024-01-06T12:00:00.000Z",
        updated_at: "2024-01-06T12:00:00.000Z",
      })
      .execute();

    await db
      .insertInto("tournament_participants")
      .values([
        {
          tournament_id: "t-1",
          user_id: "user-1",
          seed: 1,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
        },
        {
          tournament_id: "t-1",
          user_id: "user-2",
          seed: 2,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
        },
        {
          tournament_id: "t-2",
          user_id: "user-1",
          seed: 1,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
        },
        {
          tournament_id: "t-4",
          user_id: "user-1",
          seed: 1,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
        },
        {
          tournament_id: "t-4",
          user_id: "user-2",
          seed: 2,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
        },
        {
          tournament_id: "t-3",
          user_id: "user-3",
          seed: 1,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
        },
      ])
      .execute();

    await db
      .insertInto("guild_settings")
      .values([
        { guild_id: "guild-1", dashboard_public: 1 },
        { guild_id: "guild-2", dashboard_public: 1 },
      ])
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
    jest.restoreAllMocks();
  });

  it("returns cache status entries", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2024-02-01T00:00:00.000Z"));
    await db
      .insertInto("cf_cache")
      .values([
        {
          key: "problemset",
          payload: "[]",
          last_fetched: "2024-01-31T00:00:00.000Z",
        },
        {
          key: "contest_list",
          payload: "[]",
          last_fetched: "2024-01-30T00:00:00.000Z",
        },
        {
          key: "contest_list_gym",
          payload: "[]",
          last_fetched: "2024-01-29T00:00:00.000Z",
        },
      ])
      .execute();

    const status = await website.getCacheStatus();
    expect(status).toHaveLength(3);
    const problemset = status.find((entry) => entry.key === "problemset");
    expect(problemset?.lastFetched).toBe("2024-01-31T00:00:00.000Z");
    expect(problemset?.ageSeconds).toBe(24 * 60 * 60);
    const gymList = status.find((entry) => entry.key === "contest_list_gym");
    expect(gymList?.lastFetched).toBe("2024-01-29T00:00:00.000Z");
  });

  it("returns leaderboard exports for a public guild", async () => {
    const exportData = await website.getGuildLeaderboards("guild-1");
    expect(exportData?.rating).toEqual([
      { userId: "user-1", handle: "alice", rating: 1500 },
      { userId: "user-2", handle: "bob", rating: 1400 },
    ]);
    expect(exportData?.solves[0]?.handle).toBe("alice");
  });

  it("returns global overview counts", async () => {
    const overview = await website.getGlobalOverview();
    expect(overview.guildCount).toBe(2);
    expect(overview.linkedUsers).toBe(3);
    expect(overview.activeChallenges).toBe(1);
    expect(overview.completedChallenges).toBe(2);
    expect(overview.totalChallenges).toBe(3);
    expect(overview.activeTournaments).toBe(2);
    expect(overview.completedTournaments).toBe(2);
    expect(overview.totalTournaments).toBe(4);
    expect(overview.lastChallengeAt).toBe("2024-01-03T00:00:00.000Z");
    expect(overview.lastTournamentAt).toBe("2024-01-06T12:00:00.000Z");
    expect(overview.contestActivity.contestCount).toBe(0);
    expect(overview.contestActivity.participantCount).toBe(0);
    expect(overview.contestActivity.lastContestAt).toBeNull();
    expect(overview.contestActivity.byScope.official.contestCount).toBe(0);
    expect(overview.contestActivity.byScope.gym.contestCount).toBe(0);
    expect(overview.contestRatingAlerts.guildCount).toBe(0);
    expect(overview.contestRatingAlerts.subscriptionCount).toBe(0);
    expect(overview.contestRatingAlerts.lastNotifiedAt).toBeNull();
    expect(overview.contestRatingAlerts.cacheLastFetched).toBeNull();
    expect(overview.contestRatingAlerts.cacheAgeSeconds).toBeNull();
  });

  it("lists guild summaries", async () => {
    const summaries = await website.listGuildSummaries(10);
    const guild1 = summaries.find((row) => row.guildId === "guild-1");
    const guild2 = summaries.find((row) => row.guildId === "guild-2");
    expect(guild1).toMatchObject({
      linkedUsers: 2,
      activeChallenges: 1,
      completedChallenges: 1,
    });
    expect(guild2).toMatchObject({
      linkedUsers: 1,
      activeChallenges: 0,
      completedChallenges: 1,
    });
  });

  it("filters summaries to public guilds", async () => {
    await settings.setDashboardPublic("guild-2", false);
    const summaries = await website.listGuildSummaries(10);
    expect(summaries.some((row) => row.guildId === "guild-2")).toBe(false);
    expect(summaries.some((row) => row.guildId === "guild-1")).toBe(true);
  });

  it("returns per-guild overview data", async () => {
    const overview = await website.getGuildOverview("guild-1");
    expect(overview).not.toBeNull();
    expect(overview?.stats.userCount).toBe(2);
    expect(overview?.ratingLeaderboard).toHaveLength(2);
    expect(overview?.solveLeaderboard).toHaveLength(1);
    expect(overview?.tournaments).toHaveLength(3);
    const arena = overview?.tournaments.find((entry) => entry.id === "t-4");
    expect(arena?.arenaProblemCount).toBe(5);
    expect(arena?.arenaEndsAt).toBe(1700005400);
  });

  it("returns tournament recap for public guilds", async () => {
    const recap: TournamentRecap = {
      entry: {
        id: "t-1",
        format: "swiss",
        status: "completed",
        lengthMinutes: 60,
        roundCount: 2,
        ratingRanges: [],
        tags: "",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T01:00:00.000Z",
        participantCount: 2,
        winnerId: "user-1",
      },
      channelId: "channel-1",
      hostUserId: "user-1",
      standings: [],
      rounds: [],
      participantHandles: {},
    };
    mockTournaments.getRecap.mockResolvedValue(recap);

    const result = await website.getTournamentRecap("guild-1", "t-1");
    expect(result?.entry.id).toBe("t-1");
    expect(mockTournaments.getRecap).toHaveBeenCalledWith("guild-1", "t-1");
  });

  it("returns null when dashboard is private", async () => {
    await settings.setDashboardPublic("guild-1", false);
    const overview = await website.getGuildOverview("guild-1");
    expect(overview).toBeNull();
  });

  it("summarizes recent contest activity from cached rating changes", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    await db
      .insertInto("cf_cache")
      .values({
        key: "contest_list",
        payload: JSON.stringify([{ id: 101, isGym: false }]),
        last_fetched: new Date().toISOString(),
      })
      .execute();
    await db
      .insertInto("cf_rating_changes")
      .values({
        handle: "alice",
        payload: JSON.stringify([
          {
            contestId: 101,
            contestName: "Codeforces Round 101",
            rank: 100,
            oldRating: 1500,
            newRating: 1520,
            ratingUpdateTimeSeconds: nowSeconds - 600,
          },
        ]),
        last_fetched: new Date().toISOString(),
      })
      .execute();

    const overview = await website.getGuildOverview("guild-1");
    expect(overview?.contestActivity.contestCount).toBe(1);
    expect(overview?.contestActivity.participantCount).toBe(1);
    expect(overview?.contestActivity.recentContests[0]?.contestName).toBe("Codeforces Round 101");
    expect(overview?.contestActivity.byScope.official.contestCount).toBe(1);
  });

  it("summarizes global contest activity for public guilds", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    await db
      .insertInto("cf_cache")
      .values([
        {
          key: "contest_list",
          payload: JSON.stringify([{ id: 111, isGym: false }]),
          last_fetched: new Date().toISOString(),
        },
        {
          key: "contest_list_gym",
          payload: JSON.stringify([{ id: 222, isGym: true }]),
          last_fetched: new Date().toISOString(),
        },
      ])
      .execute();
    await db
      .insertInto("cf_rating_changes")
      .values([
        {
          handle: "alice",
          payload: JSON.stringify([
            {
              contestId: 111,
              contestName: "Codeforces Round 111",
              rank: 100,
              oldRating: 1500,
              newRating: 1520,
              ratingUpdateTimeSeconds: nowSeconds - 800,
            },
          ]),
          last_fetched: new Date().toISOString(),
        },
        {
          handle: "carol",
          payload: JSON.stringify([
            {
              contestId: 222,
              contestName: "Codeforces Round 222",
              rank: 10,
              oldRating: 2000,
              newRating: 2050,
              ratingUpdateTimeSeconds: nowSeconds - 200,
            },
          ]),
          last_fetched: new Date().toISOString(),
        },
      ])
      .execute();

    const overview = await website.getGlobalOverview();
    expect(overview.contestActivity.contestCount).toBe(2);
    expect(overview.contestActivity.participantCount).toBe(2);
    expect(overview.contestActivity.lastContestAt).toBe(nowSeconds - 200);
    expect(overview.contestActivity.byScope.official.contestCount).toBe(1);
    expect(overview.contestActivity.byScope.gym.contestCount).toBe(1);
  });

  it("summarizes contest rating alert coverage and cache freshness", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2024-02-01T00:00:00.000Z"));
    await db
      .insertInto("contest_rating_alert_subscriptions")
      .values([
        {
          id: "alert-1",
          guild_id: "guild-1",
          channel_id: "channel-1",
          role_id: null,
          min_delta: 0,
          include_handles: null,
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "alert-2",
          guild_id: "guild-2",
          channel_id: "channel-2",
          role_id: null,
          min_delta: 10,
          include_handles: "alice",
          created_at: "2024-01-02T00:00:00.000Z",
          updated_at: "2024-01-02T00:00:00.000Z",
        },
      ])
      .execute();
    await db
      .insertInto("contest_rating_alert_notifications")
      .values([
        {
          subscription_id: "alert-1",
          contest_id: 123,
          notified_at: "2024-01-30T12:00:00.000Z",
        },
        {
          subscription_id: "alert-2",
          contest_id: 124,
          notified_at: "2024-01-31T12:00:00.000Z",
        },
      ])
      .execute();
    await db
      .insertInto("contest_rating_changes")
      .values({
        contest_id: 123,
        payload: "[]",
        last_fetched: "2024-01-31T00:00:00.000Z",
      })
      .execute();

    const overview = await website.getGlobalOverview();
    expect(overview.contestRatingAlerts.guildCount).toBe(2);
    expect(overview.contestRatingAlerts.subscriptionCount).toBe(2);
    expect(overview.contestRatingAlerts.lastNotifiedAt).toBe("2024-01-31T12:00:00.000Z");
    expect(overview.contestRatingAlerts.cacheLastFetched).toBe("2024-01-31T00:00:00.000Z");
    expect(overview.contestRatingAlerts.cacheAgeSeconds).toBe(24 * 60 * 60);
  });

  it("returns null for unknown guilds", async () => {
    const overview = await website.getGuildOverview("missing");
    expect(overview).toBeNull();
  });

  it("returns upcoming contests when contest service is available", async () => {
    const contestService = {
      refresh: jest.fn().mockResolvedValue(undefined),
      getUpcoming: jest
        .fn()
        .mockImplementation((_limit: number, scope: "official" | "gym") =>
          scope === "official"
            ? [
                {
                  id: 1000,
                  name: "Official Contest",
                  phase: "BEFORE",
                  startTimeSeconds: 1_700_000_000,
                  durationSeconds: 7200,
                  isGym: false,
                },
              ]
            : [
                {
                  id: 2000,
                  name: "Gym Contest",
                  phase: "BEFORE",
                  startTimeSeconds: 1_700_000_500,
                  durationSeconds: 5400,
                  isGym: true,
                },
              ]
        ),
      getLastRefreshAt: jest.fn().mockReturnValue(Date.parse("2024-02-01T00:00:00.000Z")),
    };

    const contestActivity = new ContestActivityService(db, store, mockRatingChanges);
    const websiteWithContests = new WebsiteService(db, store, settings, contestActivity, {
      codeforces: mockCodeforces,
      contests: contestService as never,
      tournaments: mockTournaments,
    });

    const upcoming = await websiteWithContests.getUpcomingContests(3);

    expect(contestService.refresh).toHaveBeenCalledWith(false, "official");
    expect(contestService.refresh).toHaveBeenCalledWith(false, "gym");
    expect(upcoming.lastRefreshAt).toBe("2024-02-01T00:00:00.000Z");
    expect(upcoming.official[0]?.name).toBe("Official Contest");
    expect(upcoming.gym[0]?.name).toBe("Gym Contest");
  });
});
