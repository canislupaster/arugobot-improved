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
});
