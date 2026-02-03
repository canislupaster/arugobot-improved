import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { CodeforcesClient } from "../../src/services/codeforces.js";
import { ContestActivityService } from "../../src/services/contestActivity.js";
import type { RatingChangesService } from "../../src/services/ratingChanges.js";
import { StoreService } from "../../src/services/store.js";

const mockCodeforces = { request: jest.fn() } as unknown as CodeforcesClient;
const mockRatingChanges = {
  getRatingChanges: jest.fn().mockResolvedValue(null),
} as unknown as RatingChangesService;

const createChange = (contestId: number, contestName: string, timestamp: number) => ({
  contestId,
  contestName,
  rank: 1,
  oldRating: 1500,
  newRating: 1600,
  ratingUpdateTimeSeconds: timestamp,
});

const createChangeWithDelta = (
  contestId: number,
  contestName: string,
  timestamp: number,
  delta: number
) => ({
  contestId,
  contestName,
  rank: 1,
  oldRating: 1500,
  newRating: 1500 + delta,
  ratingUpdateTimeSeconds: timestamp,
});

describe("ContestActivityService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("summarizes guild contest activity", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store, mockRatingChanges);

    await db
      .insertInto("users")
      .values([
        {
          server_id: "guild-1",
          user_id: "user-1",
          handle: "Alice",
          rating: 1500,
          history: "[]",
          rating_history: "[]",
        },
        {
          server_id: "guild-1",
          user_id: "user-2",
          handle: "Bob",
          rating: 1400,
          history: "[]",
          rating_history: "[]",
        },
      ])
      .execute();

    const nowSeconds = Math.floor(Date.now() / 1000);
    await db
      .insertInto("cf_cache")
      .values([
        {
          key: "contest_list",
          payload: JSON.stringify([{ id: 1000, isGym: false }]),
          last_fetched: new Date().toISOString(),
        },
        {
          key: "contest_list_gym",
          payload: JSON.stringify([{ id: 1001, isGym: true }]),
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
            createChange(1000, "Contest A", nowSeconds - 3600),
            createChange(1001, "Contest B", nowSeconds - 7200),
          ]),
        },
        {
          handle: "bob",
          payload: JSON.stringify([
            createChange(1000, "Contest A", nowSeconds - 1800),
            createChange(2000, "Old Contest", nowSeconds - 200 * 24 * 60 * 60),
          ]),
        },
      ])
      .execute();

    const activity = await service.getGuildContestActivity("guild-1", {
      lookbackDays: 90,
      participantLimit: 10,
    });

    expect(activity.contestCount).toBe(2);
    expect(activity.participantCount).toBe(2);
    expect(activity.byScope.official.contestCount).toBe(1);
    expect(activity.byScope.gym.contestCount).toBe(1);
    expect(activity.byScope.official.participantCount).toBe(2);
    expect(activity.byScope.gym.participantCount).toBe(1);
    expect(activity.byScope.official.lastContestAt).toBe(nowSeconds - 1800);
    expect(activity.byScope.gym.lastContestAt).toBe(nowSeconds - 7200);
    expect(activity.topContests[0]).toMatchObject({
      contestId: 1000,
      contestName: "Contest A",
      participantCount: 2,
    });
    expect(activity.participants[0]?.handle).toBe("Alice");
    expect(activity.participants[0]?.contestCount).toBe(2);
    expect(activity.participants[0]?.officialCount).toBe(1);
    expect(activity.participants[0]?.gymCount).toBe(1);
    expect(activity.recentContests.length).toBeGreaterThan(0);

    await db.destroy();
  });

  it("applies participant limit without changing totals", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store, mockRatingChanges);

    await db
      .insertInto("users")
      .values([
        {
          server_id: "guild-1",
          user_id: "user-1",
          handle: "Alice",
          rating: 1500,
          history: "[]",
          rating_history: "[]",
        },
        {
          server_id: "guild-1",
          user_id: "user-2",
          handle: "Bob",
          rating: 1400,
          history: "[]",
          rating_history: "[]",
        },
      ])
      .execute();

    const nowSeconds = Math.floor(Date.now() / 1000);
    await db
      .insertInto("cf_cache")
      .values([
        {
          key: "contest_list",
          payload: JSON.stringify([{ id: 1000, isGym: false }]),
          last_fetched: new Date().toISOString(),
        },
      ])
      .execute();

    await db
      .insertInto("cf_rating_changes")
      .values([
        {
          handle: "alice",
          payload: JSON.stringify([createChange(1000, "Contest A", nowSeconds - 3600)]),
        },
        {
          handle: "bob",
          payload: JSON.stringify([createChange(1000, "Contest A", nowSeconds - 1800)]),
        },
      ])
      .execute();

    const activity = await service.getGuildContestActivity("guild-1", {
      lookbackDays: 90,
      participantLimit: 1,
    });

    expect(activity.participantCount).toBe(2);
    expect(activity.participants).toHaveLength(1);

    await db.destroy();
  });

  it("returns empty results for empty guilds", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store, mockRatingChanges);

    const activity = await service.getGuildContestActivity("guild-1");
    expect(activity.contestCount).toBe(0);
    expect(activity.participantCount).toBe(0);
    expect(activity.byScope.official.contestCount).toBe(0);
    expect(activity.byScope.gym.contestCount).toBe(0);
    expect(activity.topContests).toEqual([]);
    expect(activity.participants).toEqual([]);

    await db.destroy();
  });

  it("summarizes rating change deltas for a guild", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store, mockRatingChanges);

    await db
      .insertInto("users")
      .values([
        {
          server_id: "guild-1",
          user_id: "user-1",
          handle: "Alice",
          rating: 1500,
          history: "[]",
          rating_history: "[]",
        },
        {
          server_id: "guild-1",
          user_id: "user-2",
          handle: "Bob",
          rating: 1400,
          history: "[]",
          rating_history: "[]",
        },
      ])
      .execute();

    const nowSeconds = Math.floor(Date.now() / 1000);
    await db
      .insertInto("cf_rating_changes")
      .values([
        {
          handle: "alice",
          payload: JSON.stringify([
            createChangeWithDelta(2000, "Contest A", nowSeconds - 3600, 100),
            createChangeWithDelta(2001, "Contest B", nowSeconds - 7200, -50),
          ]),
        },
        {
          handle: "bob",
          payload: JSON.stringify([
            createChangeWithDelta(2002, "Contest C", nowSeconds - 1800, -25),
            createChangeWithDelta(2003, "Old Contest", nowSeconds - 200 * 24 * 60 * 60, 200),
          ]),
        },
      ])
      .execute();

    const summary = await service.getGuildRatingChangeSummary("guild-1", {
      lookbackDays: 90,
      limit: 5,
    });

    expect(summary.contestCount).toBe(3);
    expect(summary.participantCount).toBe(2);
    expect(summary.totalDelta).toBe(25);
    expect(summary.lastContestAt).toBe(nowSeconds - 1800);
    expect(summary.topGainers[0]?.handle).toBe("Alice");
    expect(summary.topGainers[0]?.delta).toBe(50);
    expect(summary.topLosers[0]?.handle).toBe("Bob");
    expect(summary.topLosers[0]?.delta).toBe(-25);

    await db.destroy();
  });

  it("filters rating change deltas by contest scope", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store, mockRatingChanges);

    await db
      .insertInto("users")
      .values([
        {
          server_id: "guild-1",
          user_id: "user-1",
          handle: "Alice",
          rating: 1500,
          history: "[]",
          rating_history: "[]",
        },
        {
          server_id: "guild-1",
          user_id: "user-2",
          handle: "Bob",
          rating: 1400,
          history: "[]",
          rating_history: "[]",
        },
      ])
      .execute();

    await db
      .insertInto("cf_cache")
      .values([
        {
          key: "contest_list",
          payload: JSON.stringify([{ id: 3000, isGym: false }]),
          last_fetched: new Date().toISOString(),
        },
        {
          key: "contest_list_gym",
          payload: JSON.stringify([{ id: 3001, isGym: true }]),
          last_fetched: new Date().toISOString(),
        },
      ])
      .execute();

    const nowSeconds = Math.floor(Date.now() / 1000);
    await db
      .insertInto("cf_rating_changes")
      .values([
        {
          handle: "alice",
          payload: JSON.stringify([
            createChangeWithDelta(3000, "Official Contest", nowSeconds - 7200, 50),
            createChangeWithDelta(3001, "Gym Contest", nowSeconds - 3600, 20),
          ]),
        },
        {
          handle: "bob",
          payload: JSON.stringify([
            createChangeWithDelta(3001, "Gym Contest", nowSeconds - 1800, -30),
          ]),
        },
      ])
      .execute();

    const summary = await service.getGuildRatingChangeSummary("guild-1", {
      lookbackDays: 30,
      limit: 5,
      scope: "gym",
    });

    expect(summary.contestCount).toBe(1);
    expect(summary.participantCount).toBe(2);
    expect(summary.totalDelta).toBe(-10);
    expect(summary.lastContestAt).toBe(nowSeconds - 1800);
    expect(summary.topGainers[0]?.handle).toBe("Alice");
    expect(summary.topGainers[0]?.delta).toBe(20);
    expect(summary.topLosers[0]?.handle).toBe("Bob");
    expect(summary.topLosers[0]?.delta).toBe(-30);

    await db.destroy();
  });

  it("summarizes global contest activity", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store, mockRatingChanges);

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
          server_id: "guild-2",
          user_id: "user-2",
          handle: "bob",
          rating: 1400,
          history: "[]",
          rating_history: "[]",
        },
      ])
      .execute();

    const nowSeconds = Math.floor(Date.now() / 1000);
    await db
      .insertInto("cf_cache")
      .values([
        {
          key: "contest_list",
          payload: JSON.stringify([{ id: 999, isGym: false }]),
          last_fetched: new Date().toISOString(),
        },
        {
          key: "contest_list_gym",
          payload: JSON.stringify([{ id: 998, isGym: true }]),
          last_fetched: new Date().toISOString(),
        },
      ])
      .execute();

    await db
      .insertInto("cf_rating_changes")
      .values([
        {
          handle: "alice",
          payload: JSON.stringify([createChange(999, "Contest X", nowSeconds - 60)]),
        },
        {
          handle: "bob",
          payload: JSON.stringify([createChange(998, "Contest Y", nowSeconds - 120)]),
        },
      ])
      .execute();

    const activity = await service.getGlobalContestActivity(["guild-1", "guild-2"], 90);
    expect(activity.contestCount).toBe(2);
    expect(activity.participantCount).toBe(2);
    expect(activity.byScope.official.contestCount).toBe(1);
    expect(activity.byScope.gym.contestCount).toBe(1);
    expect(activity.byScope.official.participantCount).toBe(1);
    expect(activity.byScope.gym.participantCount).toBe(1);
    expect(activity.byScope.official.lastContestAt).toBe(nowSeconds - 60);
    expect(activity.byScope.gym.lastContestAt).toBe(nowSeconds - 120);
    expect(activity.lastContestAt).not.toBeNull();

    await db.destroy();
  });

  it("summarizes rating change deltas", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store, mockRatingChanges);

    await db
      .insertInto("users")
      .values([
        {
          server_id: "guild-1",
          user_id: "user-1",
          handle: "Alice",
          rating: 1500,
          history: "[]",
          rating_history: "[]",
        },
        {
          server_id: "guild-1",
          user_id: "user-2",
          handle: "Bob",
          rating: 1400,
          history: "[]",
          rating_history: "[]",
        },
      ])
      .execute();

    const nowSeconds = Math.floor(Date.now() / 1000);
    await db
      .insertInto("cf_rating_changes")
      .values([
        {
          handle: "alice",
          payload: JSON.stringify([
            createChangeWithDelta(2000, "Contest A", nowSeconds - 3600, 120),
          ]),
        },
        {
          handle: "bob",
          payload: JSON.stringify([
            createChangeWithDelta(2000, "Contest A", nowSeconds - 3600, -80),
          ]),
        },
      ])
      .execute();

    const summary = await service.getGuildRatingChangeSummary("guild-1", {
      lookbackDays: 30,
      limit: 2,
    });

    expect(summary.contestCount).toBe(1);
    expect(summary.participantCount).toBe(2);
    expect(summary.totalDelta).toBe(40);
    expect(summary.topGainers[0]?.handle).toBe("Alice");
    expect(summary.topGainers[0]?.delta).toBe(120);
    expect(summary.topLosers[0]?.handle).toBe("Bob");
    expect(summary.topLosers[0]?.delta).toBe(-80);

    await db.destroy();
  });

  it("refreshes missing rating changes for roster handles", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const ratingChanges = {
      getRatingChanges: jest.fn().mockResolvedValue(null),
    } as unknown as RatingChangesService;
    const service = new ContestActivityService(db, store, ratingChanges);

    await db
      .insertInto("users")
      .values({
        server_id: "guild-1",
        user_id: "user-1",
        handle: "Alice",
        rating: 1500,
        history: "[]",
        rating_history: "[]",
      })
      .execute();

    await service.getGuildContestActivity("guild-1");
    expect(ratingChanges.getRatingChanges).toHaveBeenCalledWith("Alice");

    await db.destroy();
  });
});
