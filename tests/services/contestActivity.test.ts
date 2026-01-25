import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { CodeforcesClient } from "../../src/services/codeforces.js";
import { ContestActivityService } from "../../src/services/contestActivity.js";
import { StoreService } from "../../src/services/store.js";

const mockCodeforces = { request: jest.fn() } as unknown as CodeforcesClient;

const createChange = (contestId: number, contestName: string, timestamp: number) => ({
  contestId,
  contestName,
  rank: 1,
  oldRating: 1500,
  newRating: 1600,
  ratingUpdateTimeSeconds: timestamp,
});

describe("ContestActivityService", () => {
  it("summarizes guild contest activity", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store);

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
    expect(activity.participants[0]?.handle).toBe("Alice");
    expect(activity.participants[0]?.contestCount).toBe(2);
    expect(activity.participants[0]?.officialCount).toBe(1);
    expect(activity.participants[0]?.gymCount).toBe(1);
    expect(activity.recentContests.length).toBeGreaterThan(0);

    await db.destroy();
  });

  it("returns empty results for empty guilds", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store);

    const activity = await service.getGuildContestActivity("guild-1");
    expect(activity.contestCount).toBe(0);
    expect(activity.participantCount).toBe(0);
    expect(activity.byScope.official.contestCount).toBe(0);
    expect(activity.byScope.gym.contestCount).toBe(0);
    expect(activity.participants).toEqual([]);

    await db.destroy();
  });

  it("summarizes global contest activity", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const service = new ContestActivityService(db, store);

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
    expect(activity.lastContestAt).not.toBeNull();

    await db.destroy();
  });
});
