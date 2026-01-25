import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { StoreService } from "../../src/services/store.js";

const mockClient = {
  request: jest.fn(),
};

describe("StoreService", () => {
  let db: Kysely<Database>;
  let store: StoreService;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    store = new StoreService(db, mockClient as never);
  });

  afterEach(async () => {
    await db.destroy();
    mockClient.request.mockReset();
  });

  it("inserts and fetches user data", async () => {
    const result = await store.insertUser("guild-1", "user-1", "tourist");
    expect(result).toBe("ok");

    const linked = await store.handleLinked("guild-1", "user-1");
    expect(linked).toBe(true);

    const rating = await store.getRating("guild-1", "user-1");
    expect(rating).toBe(1500);

    await store.updateRating("guild-1", "user-1", 1600);
    const updatedRating = await store.getRating("guild-1", "user-1");
    expect(updatedRating).toBe(1600);
  });

  it("prevents duplicate handles and duplicate links", async () => {
    const first = await store.insertUser("guild-1", "user-1", "tourist");
    expect(first).toBe("ok");

    const duplicateHandle = await store.insertUser("guild-1", "user-2", "tourist");
    expect(duplicateHandle).toBe("handle_exists");

    const duplicateLink = await store.insertUser("guild-1", "user-1", "petr");
    expect(duplicateLink).toBe("already_linked");
  });

  it("updates a linked handle and preserves rating history", async () => {
    await store.insertUser("guild-1", "user-1", "tourist");
    await store.updateRating("guild-1", "user-1", 1650);
    await store.addToHistory("guild-1", "user-1", "1000A");

    const result = await store.updateUserHandle("guild-1", "user-1", "petr");
    expect(result).toBe("ok");

    const handle = await store.getHandle("guild-1", "user-1");
    expect(handle).toBe("petr");
    const rating = await store.getRating("guild-1", "user-1");
    expect(rating).toBe(1650);
    const history = await store.getHistoryList("guild-1", "user-1");
    expect(history).toContain("1000A");
  });

  it("rejects handle updates for missing or taken handles", async () => {
    const missing = await store.updateUserHandle("guild-1", "user-1", "petr");
    expect(missing).toBe("not_linked");

    await store.insertUser("guild-1", "user-1", "tourist");
    await store.insertUser("guild-1", "user-2", "petr");

    const taken = await store.updateUserHandle("guild-1", "user-1", "petr");
    expect(taken).toBe("handle_exists");
  });

  it("looks up linked user ids by handle", async () => {
    await store.insertUser("guild-1", "user-1", "tourist");
    await store.insertUser("guild-1", "user-2", "petr");

    const userId = await store.getUserIdByHandle("guild-1", "tourist");
    expect(userId).toBe("user-1");

    const missing = await store.getUserIdByHandle("guild-1", "unknown");
    expect(missing).toBeNull();
  });

  it("caches handle resolution results", async () => {
    mockClient.request.mockResolvedValueOnce([{ handle: "Tourist" }]);

    const first = await store.resolveHandle("tourist");
    expect(first.exists).toBe(true);
    expect(first.canonicalHandle).toBe("Tourist");
    expect(first.source).toBe("api");
    expect(mockClient.request).toHaveBeenCalledTimes(1);

    const second = await store.resolveHandle("tourist");
    expect(second.exists).toBe(true);
    expect(second.canonicalHandle).toBe("Tourist");
    expect(second.source).toBe("cache");
    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });

  it("accepts profile URLs for handle resolution", async () => {
    mockClient.request.mockResolvedValueOnce([{ handle: "Tourist" }]);

    const result = await store.resolveHandle("https://codeforces.com/profile/tourist");

    expect(result.exists).toBe(true);
    expect(result.canonicalHandle).toBe("Tourist");
    expect(mockClient.request).toHaveBeenCalledWith("user.info", { handles: "tourist" });
  });

  it("falls back to cached handle data when the API fails", async () => {
    mockClient.request.mockResolvedValueOnce([{ handle: "Tourist" }]);
    await store.resolveHandle("tourist");

    mockClient.request.mockRejectedValueOnce(new Error("CF down"));
    const fallback = await store.resolveHandle("tourist", 0);

    expect(fallback.exists).toBe(true);
    expect(fallback.canonicalHandle).toBe("Tourist");
    expect(fallback.source).toBe("cache");
  });

  it("caches contest solves and reuses fresh cache", async () => {
    mockClient.request.mockResolvedValueOnce([
      {
        id: 10,
        contestId: 1000,
        creationTimeSeconds: 1200,
        verdict: "OK",
        problem: { contestId: 1000, index: "A" },
        author: { members: [{ handle: "tourist" }] },
      },
    ]);

    const first = await store.getContestSolvesResult(1000);
    expect(first?.solves).toHaveLength(1);
    expect(first?.solves[0]?.handle).toBe("tourist");

    const second = await store.getContestSolvesResult(1000);
    expect(second?.source).toBe("cache");
    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });

  it("falls back to cached contest solves when the API fails", async () => {
    mockClient.request.mockResolvedValueOnce([
      {
        id: 11,
        contestId: 1000,
        creationTimeSeconds: 1300,
        verdict: "OK",
        problem: { contestId: 1000, index: "B" },
        author: { members: [{ handle: "tourist" }] },
      },
    ]);

    await store.getContestSolvesResult(1000);

    mockClient.request.mockRejectedValueOnce(new Error("CF down"));
    const fallback = await store.getContestSolvesResult(1000, 0);

    expect(fallback?.source).toBe("cache");
    expect(fallback?.isStale).toBe(true);
    expect(fallback?.solves).toHaveLength(1);
  });

  it("returns server roster and stats", async () => {
    await store.insertUser("guild-1", "user-1", "tourist");
    await store.insertUser("guild-1", "user-2", "petr");
    await store.updateRating("guild-1", "user-1", 1600);
    await store.addToHistory("guild-1", "user-1", "1000A");

    const roster = await store.getServerRoster("guild-1");
    expect(roster).toHaveLength(2);
    expect(roster[0].userId).toBe("user-1");
    expect(roster[0].rating).toBe(1600);

    const stats = await store.getServerStats("guild-1");
    expect(stats.userCount).toBe(2);
    expect(stats.totalChallenges).toBe(1);
    expect(stats.avgRating).toBe(1550);
    expect(stats.topRating).toBe(1600);
  });

  it("counts completed challenges, not participants", async () => {
    await store.insertUser("guild-1", "user-1", "tourist");
    await store.insertUser("guild-1", "user-2", "petr");

    const now = Math.floor(Date.now() / 1000);

    await db
      .insertInto("challenges")
      .values([
        {
          id: "challenge-1",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-1",
          host_user_id: "user-1",
          problem_contest_id: 1000,
          problem_index: "A",
          problem_name: "Problem One",
          problem_rating: 1200,
          length_minutes: 60,
          status: "completed",
          started_at: now,
          ends_at: now + 3600,
          check_index: 0,
        },
        {
          id: "challenge-2",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-2",
          host_user_id: "user-2",
          problem_contest_id: 1001,
          problem_index: "B",
          problem_name: "Problem Two",
          problem_rating: 1300,
          length_minutes: 60,
          status: "completed",
          started_at: now,
          ends_at: now + 3600,
          check_index: 0,
        },
      ])
      .execute();

    await db
      .insertInto("challenge_participants")
      .values([
        { challenge_id: "challenge-1", user_id: "user-1", position: 1 },
        { challenge_id: "challenge-1", user_id: "user-2", position: 2 },
        { challenge_id: "challenge-2", user_id: "user-1", position: 1 },
        { challenge_id: "challenge-2", user_id: "user-2", position: 2 },
      ])
      .execute();

    const stats = await store.getServerStats("guild-1");

    expect(stats.totalChallenges).toBe(2);
  });

  it("returns linked users for a server", async () => {
    await store.insertUser("guild-1", "user-1", "tourist");
    await store.insertUser("guild-1", "user-2", "petr");

    const linked = await store.getLinkedUsers("guild-1");

    expect(linked).toHaveLength(2);
    expect(linked).toEqual(
      expect.arrayContaining([
        { userId: "user-1", handle: "tourist" },
        { userId: "user-2", handle: "petr" },
      ])
    );
  });

  it("returns empty stats when no users are linked", async () => {
    const stats = await store.getServerStats("missing-guild");
    expect(stats.userCount).toBe(0);
    expect(stats.totalChallenges).toBe(0);
    expect(stats.avgRating).toBeNull();
    expect(stats.topRating).toBeNull();
  });

  it("refreshes handles to canonical casing", async () => {
    await store.insertUser("guild-1", "user-1", "tourist");
    mockClient.request.mockResolvedValueOnce([{ handle: "Tourist" }]);

    const summary = await store.refreshHandles();

    expect(summary.checked).toBe(1);
    expect(summary.updated).toBe(1);
    const handle = await store.getHandle("guild-1", "user-1");
    expect(handle).toBe("Tourist");
  });

  it("normalizes solved cache handles", async () => {
    await db
      .insertInto("ac")
      .values({
        handle: "Tourist",
        solved: JSON.stringify(["1A"]),
        last_sub: 10,
        updated_at: new Date().toISOString(),
      })
      .execute();

    const solved = await store.getSolvedProblems("tourist");

    expect(solved).toEqual(["1A"]);
    const rows = await db.selectFrom("ac").select("handle").execute();
    expect(rows).toEqual([{ handle: "tourist" }]);
  });

  it("caches Codeforces profile data and serves stale cache on failure", async () => {
    mockClient.request.mockResolvedValueOnce([
      {
        handle: "Tourist",
        rating: 3700,
        rank: "legendary grandmaster",
        maxRating: 3800,
        maxRank: "legendary grandmaster",
        lastOnlineTimeSeconds: 123,
      },
    ]);

    const first = await store.getCodeforcesProfile("tourist");
    expect(first?.source).toBe("api");
    expect(first?.isStale).toBe(false);
    expect(first?.profile.displayHandle).toBe("Tourist");

    mockClient.request.mockRejectedValueOnce(new Error("CF down"));
    const second = await store.getCodeforcesProfile("tourist", 0);
    expect(second?.source).toBe("cache");
    expect(second?.isStale).toBe(true);
    expect(second?.profile.rating).toBe(3700);
  });

  it("caches recent submissions and serves stale cache on failure", async () => {
    mockClient.request.mockResolvedValueOnce([
      {
        id: 123,
        verdict: "OK",
        contestId: 1000,
        problem: { contestId: 1000, index: "A", name: "Test Problem" },
        creationTimeSeconds: 999,
        programmingLanguage: "GNU C++17",
      },
    ]);

    const first = await store.getRecentSubmissions("tourist", 5);
    expect(first?.source).toBe("api");
    expect(first?.isStale).toBe(false);
    expect(first?.submissions[0]?.id).toBe(123);

    mockClient.request.mockRejectedValueOnce(new Error("CF down"));
    const second = await store.getRecentSubmissions("tourist", 5, 0);
    expect(second?.source).toBe("cache");
    expect(second?.isStale).toBe(true);
    expect(second?.submissions[0]?.name).toBe("Test Problem");
  });

  it("reuses cached solved list when fresh", async () => {
    mockClient.request.mockResolvedValueOnce([
      {
        id: 10,
        verdict: "OK",
        contestId: 1,
        problem: { contestId: 1, index: "A" },
        creationTimeSeconds: 100,
      },
    ]);

    const first = await store.getSolvedProblems("tourist");
    expect(first).toEqual(["1A"]);
    expect(mockClient.request).toHaveBeenCalledTimes(1);

    const second = await store.getSolvedProblems("tourist");
    expect(second).toEqual(["1A"]);
    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });

  it("serves cached solved list when refresh fails", async () => {
    mockClient.request.mockResolvedValueOnce([
      {
        id: 10,
        verdict: "OK",
        contestId: 1,
        problem: { contestId: 1, index: "A" },
        creationTimeSeconds: 100,
      },
    ]);

    const first = await store.getSolvedProblems("tourist");
    expect(first).toEqual(["1A"]);

    mockClient.request.mockRejectedValueOnce(new Error("CF down"));
    const second = await store.getSolvedProblemsResult("tourist", 0);

    expect(second?.source).toBe("cache");
    expect(second?.isStale).toBe(true);
    expect(second?.solved).toEqual(["1A"]);
  });

  it("caps solved list fetch pages when configured", async () => {
    store = new StoreService(db, mockClient as never, { maxSolvedPages: 1 });
    mockClient.request.mockResolvedValueOnce(
      Array.from({ length: 5000 }, (_, index) => ({
        id: index + 1,
        verdict: "OK",
        contestId: 1,
        problem: { contestId: 1, index: "A" },
        creationTimeSeconds: 100,
      }))
    );

    const solved = await store.getSolvedProblems("tourist", 0);

    expect(mockClient.request).toHaveBeenCalledTimes(1);
    expect(solved).toContain("1A");
  });

  it("returns challenge history entries from completed challenges", async () => {
    await store.insertUser("guild-1", "user-1", "tourist");

    await db
      .insertInto("challenges")
      .values({
        id: "challenge-1",
        server_id: "guild-1",
        channel_id: "channel-1",
        message_id: "message-1",
        host_user_id: "user-1",
        problem_contest_id: 1000,
        problem_index: "A",
        problem_name: "Test Problem",
        problem_rating: 1200,
        length_minutes: 40,
        status: "completed",
        started_at: 1000,
        ends_at: 2000,
        check_index: 0,
        updated_at: new Date().toISOString(),
      })
      .execute();

    await db
      .insertInto("challenge_participants")
      .values({
        challenge_id: "challenge-1",
        user_id: "user-1",
        position: 0,
        solved_at: 1500,
        rating_before: 1500,
        rating_delta: 25,
        updated_at: new Date().toISOString(),
      })
      .execute();

    const history = await store.getChallengeHistoryPage("guild-1", "user-1", 1, 10);

    expect(history.total).toBe(1);
    expect(history.entries[0]?.problemId).toBe("1000A");
    expect(history.entries[0]?.ratingDelta).toBe(25);
  });

  it("summarizes challenge activity windows", async () => {
    const now = Date.now();
    const recentIso = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const oldIso = new Date(now - 25 * 24 * 60 * 60 * 1000).toISOString();
    const sinceIso = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();

    await db
      .insertInto("challenges")
      .values([
        {
          id: "challenge-1",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-1",
          host_user_id: "user-1",
          problem_contest_id: 1000,
          problem_index: "A",
          problem_name: "Recent Problem",
          problem_rating: 1200,
          length_minutes: 40,
          status: "completed",
          started_at: 1000,
          ends_at: 2000,
          check_index: 0,
          updated_at: recentIso,
        },
        {
          id: "challenge-2",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-2",
          host_user_id: "user-2",
          problem_contest_id: 1001,
          problem_index: "B",
          problem_name: "Old Problem",
          problem_rating: 1100,
          length_minutes: 40,
          status: "completed",
          started_at: 1000,
          ends_at: 2000,
          check_index: 0,
          updated_at: oldIso,
        },
      ])
      .execute();

    await db
      .insertInto("challenge_participants")
      .values([
        {
          challenge_id: "challenge-1",
          user_id: "user-1",
          position: 0,
          solved_at: 1500,
          rating_before: 1500,
          rating_delta: 20,
          updated_at: recentIso,
        },
        {
          challenge_id: "challenge-1",
          user_id: "user-2",
          position: 1,
          solved_at: null,
          rating_before: 1500,
          rating_delta: -10,
          updated_at: recentIso,
        },
        {
          challenge_id: "challenge-2",
          user_id: "user-1",
          position: 0,
          solved_at: 1600,
          rating_before: 1520,
          rating_delta: 15,
          updated_at: oldIso,
        },
      ])
      .execute();

    const summary = await store.getChallengeActivity("guild-1", sinceIso, 3);
    expect(summary.completedChallenges).toBe(1);
    expect(summary.participantCount).toBe(2);
    expect(summary.uniqueParticipants).toBe(2);
    expect(summary.solvedCount).toBe(1);
    expect(summary.topSolvers[0]).toEqual({ userId: "user-1", solvedCount: 1 });

    const userSummary = await store.getUserChallengeActivity("guild-1", "user-1", sinceIso);
    expect(userSummary.participations).toBe(1);
    expect(userSummary.solvedCount).toBe(1);
    expect(userSummary.lastCompletedAt).toBe(recentIso);
  });

  it("computes challenge streaks", async () => {
    const base = 1_700_000_000;
    const day = 86400;
    const nowMs = (base + day * 5) * 1000;

    await db
      .insertInto("challenges")
      .values([
        {
          id: "challenge-1",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-1",
          host_user_id: "user-1",
          problem_contest_id: 1000,
          problem_index: "A",
          problem_name: "Problem A",
          problem_rating: 1200,
          length_minutes: 40,
          status: "completed",
          started_at: base,
          ends_at: base + 3600,
          check_index: 0,
        },
        {
          id: "challenge-2",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-2",
          host_user_id: "user-1",
          problem_contest_id: 1001,
          problem_index: "B",
          problem_name: "Problem B",
          problem_rating: 1300,
          length_minutes: 40,
          status: "completed",
          started_at: base + day,
          ends_at: base + day + 3600,
          check_index: 0,
        },
        {
          id: "challenge-3",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-3",
          host_user_id: "user-1",
          problem_contest_id: 1002,
          problem_index: "C",
          problem_name: "Problem C",
          problem_rating: 1400,
          length_minutes: 40,
          status: "completed",
          started_at: base + day * 3,
          ends_at: base + day * 3 + 3600,
          check_index: 0,
        },
      ])
      .execute();

    await db
      .insertInto("challenge_participants")
      .values([
        {
          challenge_id: "challenge-1",
          user_id: "user-1",
          position: 0,
          solved_at: base + day,
        },
        {
          challenge_id: "challenge-2",
          user_id: "user-1",
          position: 0,
          solved_at: base + day * 2,
        },
        {
          challenge_id: "challenge-3",
          user_id: "user-1",
          position: 0,
          solved_at: base + day * 4,
        },
      ])
      .execute();

    const streak = await store.getChallengeStreak("guild-1", "user-1", nowMs);
    expect(streak.currentStreak).toBe(1);
    expect(streak.longestStreak).toBe(2);
    expect(streak.totalSolvedDays).toBe(3);
    expect(streak.lastSolvedAt).toBe(new Date((base + day * 4) * 1000).toISOString());
  });

  it("clears current streak when last solve is older than yesterday", async () => {
    const base = 1_700_000_000;
    const day = 86400;
    const nowMs = (base + day * 5) * 1000;

    await db
      .insertInto("challenges")
      .values({
        id: "challenge-4",
        server_id: "guild-1",
        channel_id: "channel-1",
        message_id: "message-4",
        host_user_id: "user-1",
        problem_contest_id: 1003,
        problem_index: "D",
        problem_name: "Problem D",
        problem_rating: 1500,
        length_minutes: 40,
        status: "completed",
        started_at: base,
        ends_at: base + 3600,
        check_index: 0,
      })
      .execute();

    await db
      .insertInto("challenge_participants")
      .values({
        challenge_id: "challenge-4",
        user_id: "user-1",
        position: 0,
        solved_at: base + day,
      })
      .execute();

    const streak = await store.getChallengeStreak("guild-1", "user-1", nowMs);
    expect(streak.currentStreak).toBe(0);
    expect(streak.longestStreak).toBe(1);
  });

  it("builds a streak leaderboard", async () => {
    const base = 1_700_000_000;
    const day = 86400;
    const nowMs = (base + day * 3) * 1000;

    await db
      .insertInto("challenges")
      .values([
        {
          id: "challenge-10",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-10",
          host_user_id: "user-1",
          problem_contest_id: 2000,
          problem_index: "A",
          problem_name: "Problem A",
          problem_rating: 1200,
          length_minutes: 40,
          status: "completed",
          started_at: base,
          ends_at: base + 3600,
          check_index: 0,
        },
        {
          id: "challenge-11",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-11",
          host_user_id: "user-2",
          problem_contest_id: 2001,
          problem_index: "B",
          problem_name: "Problem B",
          problem_rating: 1300,
          length_minutes: 40,
          status: "completed",
          started_at: base + day,
          ends_at: base + day + 3600,
          check_index: 0,
        },
      ])
      .execute();

    await db
      .insertInto("challenge_participants")
      .values([
        {
          challenge_id: "challenge-10",
          user_id: "user-1",
          position: 0,
          solved_at: base + day * 2,
        },
        {
          challenge_id: "challenge-11",
          user_id: "user-2",
          position: 0,
          solved_at: base + day,
        },
      ])
      .execute();

    const leaderboard = await store.getStreakLeaderboard("guild-1", nowMs);
    expect(leaderboard[0]?.userId).toBe("user-1");
    expect(leaderboard[0]?.currentStreak).toBe(1);
    expect(leaderboard[1]?.userId).toBe("user-2");
  });

  it("returns solve leaderboard ordered by solves", async () => {
    await db
      .insertInto("challenges")
      .values([
        {
          id: "challenge-1",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-1",
          host_user_id: "user-1",
          problem_contest_id: 1000,
          problem_index: "A",
          problem_name: "Problem A",
          problem_rating: 1200,
          length_minutes: 40,
          status: "completed",
          started_at: 1000,
          ends_at: 2000,
          check_index: 0,
          updated_at: new Date().toISOString(),
        },
        {
          id: "challenge-2",
          server_id: "guild-1",
          channel_id: "channel-1",
          message_id: "message-2",
          host_user_id: "user-2",
          problem_contest_id: 1001,
          problem_index: "B",
          problem_name: "Problem B",
          problem_rating: 1300,
          length_minutes: 40,
          status: "completed",
          started_at: 2000,
          ends_at: 3000,
          check_index: 0,
          updated_at: new Date().toISOString(),
        },
      ])
      .execute();

    await db
      .insertInto("challenge_participants")
      .values([
        {
          challenge_id: "challenge-1",
          user_id: "user-1",
          position: 0,
          solved_at: 1500,
          updated_at: new Date().toISOString(),
        },
        {
          challenge_id: "challenge-1",
          user_id: "user-2",
          position: 1,
          solved_at: 1600,
          updated_at: new Date().toISOString(),
        },
        {
          challenge_id: "challenge-2",
          user_id: "user-1",
          position: 0,
          solved_at: 2500,
          updated_at: new Date().toISOString(),
        },
        {
          challenge_id: "challenge-2",
          user_id: "user-3",
          position: 1,
          solved_at: null,
          updated_at: new Date().toISOString(),
        },
      ])
      .execute();

    const leaderboard = await store.getSolveLeaderboard("guild-1");

    expect(leaderboard).toEqual([
      { userId: "user-1", solvedCount: 2 },
      { userId: "user-2", solvedCount: 1 },
    ]);
  });

  it("tracks and trims recent practice suggestions", async () => {
    const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oldTimestamp = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    await store.recordPracticeSuggestion("guild-1", "user-1", "1000A");
    await db
      .insertInto("practice_suggestions")
      .values({
        guild_id: "guild-1",
        user_id: "user-1",
        problem_id: "1000B",
        suggested_at: oldTimestamp,
      })
      .execute();

    const recent = await store.getRecentPracticeSuggestions("guild-1", "user-1", recentCutoff);
    expect(recent).toContain("1000A");
    expect(recent).not.toContain("1000B");

    await store.cleanupPracticeSuggestions(recentCutoff);
    const rows = await db.selectFrom("practice_suggestions").select("problem_id").execute();
    expect(rows.map((row) => row.problem_id)).toEqual(["1000A"]);
  });

  it("returns practice suggestion history in descending order", async () => {
    await db
      .insertInto("practice_suggestions")
      .values([
        {
          guild_id: "guild-1",
          user_id: "user-1",
          problem_id: "1000A",
          suggested_at: "2024-01-01T00:00:00.000Z",
        },
        {
          guild_id: "guild-1",
          user_id: "user-1",
          problem_id: "1000B",
          suggested_at: "2024-01-03T00:00:00.000Z",
        },
        {
          guild_id: "guild-1",
          user_id: "user-1",
          problem_id: "1000C",
          suggested_at: "2024-01-02T00:00:00.000Z",
        },
      ])
      .execute();

    const history = await store.getPracticeSuggestionHistory("guild-1", "user-1", 2);
    expect(history).toEqual([
      { problemId: "1000B", suggestedAt: "2024-01-03T00:00:00.000Z" },
      { problemId: "1000C", suggestedAt: "2024-01-02T00:00:00.000Z" },
    ]);
  });

  it("stores and clears practice preferences", async () => {
    const ranges = [{ min: 900, max: 1200 }];
    await store.setPracticePreferences("guild-1", "user-1", ranges, "dp");

    const preferences = await store.getPracticePreferences("guild-1", "user-1");
    expect(preferences?.ratingRanges).toEqual(ranges);
    expect(preferences?.tags).toBe("dp");

    const cleared = await store.clearPracticePreferences("guild-1", "user-1");
    expect(cleared).toBe(true);

    const afterClear = await store.getPracticePreferences("guild-1", "user-1");
    expect(afterClear).toBeNull();
  });
});
