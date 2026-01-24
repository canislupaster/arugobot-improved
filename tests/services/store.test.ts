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

  it("returns empty stats when no users are linked", async () => {
    const stats = await store.getServerStats("missing-guild");
    expect(stats.userCount).toBe(0);
    expect(stats.totalChallenges).toBe(0);
    expect(stats.avgRating).toBeNull();
    expect(stats.topRating).toBeNull();
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
});
