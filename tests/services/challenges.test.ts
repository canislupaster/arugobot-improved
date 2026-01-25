import type { Client } from "discord.js";
import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { ChallengeService } from "../../src/services/challenges.js";
import { StoreService } from "../../src/services/store.js";
import { getRatingChanges } from "../../src/utils/rating.js";

const createClientMock = () => {
  const message = { edit: jest.fn().mockResolvedValue(undefined) };
  const channel = {
    isTextBased: () => true,
    messages: {
      fetch: jest.fn().mockResolvedValue(message),
    },
  };
  const client = {
    channels: {
      fetch: jest.fn().mockResolvedValue(channel),
    },
  } as unknown as Client;
  return { client, message, channel };
};

describe("ChallengeService", () => {
  let db: Kysely<Database>;
  const mockCodeforces = {
    request: jest.fn(),
  };

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    mockCodeforces.request.mockReset();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("marks a participant as solved and updates rating on tick", async () => {
    const store = new StoreService(db, mockCodeforces as never);
    await store.insertUser("guild-1", "user-1", "tourist");
    await store.insertUser("guild-1", "user-2", "petr");

    const clock = { nowSeconds: () => 1010 };
    const service = new ChallengeService(db, store, mockCodeforces as never, clock);
    const { client, message } = createClientMock();

    mockCodeforces.request.mockResolvedValueOnce([
      {
        verdict: "OK",
        creationTimeSeconds: 1005,
        problem: { contestId: 1000, index: "A" },
      },
    ]);

    await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      hostUserId: "user-1",
      problem: { contestId: 1000, index: "A", name: "Test", rating: 1200 },
      lengthMinutes: 40,
      participants: ["user-1", "user-2"],
      startedAt: 1000,
    });

    await service.runTick(client);

    const [down, up] = getRatingChanges(1500, 1200, 40);
    expect(up).toBeGreaterThan(0);

    const rating = await store.getRating("guild-1", "user-1");
    expect(rating).toBe(1500 + up);

    const row = await db
      .selectFrom("challenge_participants")
      .select(["solved_at", "rating_delta"])
      .where(
        "challenge_id",
        "=",
        (await db.selectFrom("challenges").select("id").executeTakeFirstOrThrow()).id
      )
      .where("user_id", "=", "user-1")
      .executeTakeFirst();
    expect(row?.solved_at).not.toBeNull();
    expect(row?.rating_delta).toBe(up);
    expect(message.edit).toHaveBeenCalled();
    expect(down).toBeLessThan(0);
  });

  it("includes streak updates when a challenge completes", async () => {
    const store = new StoreService(db, mockCodeforces as never);
    await store.insertUser("guild-1", "user-1", "tourist");

    const clock = { nowSeconds: () => 1010 };
    const service = new ChallengeService(db, store, mockCodeforces as never, clock);
    const { client, message } = createClientMock();

    mockCodeforces.request.mockResolvedValueOnce([
      {
        verdict: "OK",
        creationTimeSeconds: 1005,
        problem: { contestId: 1000, index: "A" },
      },
    ]);

    await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      hostUserId: "user-1",
      problem: { contestId: 1000, index: "A", name: "Test", rating: 1200 },
      lengthMinutes: 40,
      participants: ["user-1"],
      startedAt: 1000,
    });

    await service.runTick(client);
    await service.runTick(client);

    const calls = (message.edit as jest.Mock).mock.calls;
    const payload = calls[calls.length - 1]?.[0];
    const fields = payload?.embeds?.[0]?.data?.fields ?? [];
    const streakField = fields.find((field: { name: string }) => field.name === "Streaks");
    expect(streakField?.value ?? "").toContain("streak now 1 days");
  });

  it("completes a challenge and applies penalties after time expires", async () => {
    const store = new StoreService(db, mockCodeforces as never);
    await store.insertUser("guild-1", "user-1", "tourist");

    const clock = { nowSeconds: () => 2000 };
    const service = new ChallengeService(db, store, mockCodeforces as never, clock);
    const { client } = createClientMock();

    mockCodeforces.request.mockResolvedValueOnce([]);

    await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      hostUserId: "user-1",
      problem: { contestId: 1000, index: "A", name: "Test", rating: 1200 },
      lengthMinutes: 10,
      participants: ["user-1"],
      startedAt: 1000,
    });

    await service.runTick(client);

    const [down] = getRatingChanges(1500, 1200, 10);
    const rating = await store.getRating("guild-1", "user-1");
    expect(rating).toBe(1500 + down);

    const statusRow = await db.selectFrom("challenges").select("status").executeTakeFirstOrThrow();
    expect(statusRow.status).toBe("completed");

    const participantRow = await db
      .selectFrom("challenge_participants")
      .select("rating_delta")
      .executeTakeFirst();
    expect(participantRow?.rating_delta).toBe(down);
  });

  it("keeps challenges active when Codeforces requests fail", async () => {
    const store = new StoreService(db, mockCodeforces as never);
    await store.insertUser("guild-1", "user-1", "tourist");

    const clock = { nowSeconds: () => 1010 };
    const service = new ChallengeService(db, store, mockCodeforces as never, clock);
    const { client } = createClientMock();

    mockCodeforces.request.mockRejectedValueOnce(new Error("CF down"));

    await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      hostUserId: "user-1",
      problem: { contestId: 1000, index: "A", name: "Test", rating: 1200 },
      lengthMinutes: 40,
      participants: ["user-1"],
      startedAt: 1000,
    });

    await service.runTick(client);

    const statusRow = await db.selectFrom("challenges").select("status").executeTakeFirstOrThrow();
    expect(statusRow.status).toBe("active");
  });

  it("cancels an active challenge without changing ratings", async () => {
    const store = new StoreService(db, mockCodeforces as never);
    await store.insertUser("guild-1", "user-1", "tourist");

    const service = new ChallengeService(db, store, mockCodeforces as never);
    const { client, message } = createClientMock();

    const challengeId = await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      hostUserId: "user-1",
      problem: { contestId: 1000, index: "A", name: "Test", rating: 1200 },
      lengthMinutes: 40,
      participants: ["user-1"],
      startedAt: 1000,
    });

    const cancelled = await service.cancelChallenge(challengeId, "user-1", client);

    expect(cancelled).toBe(true);
    const statusRow = await db
      .selectFrom("challenges")
      .select("status")
      .where("id", "=", challengeId)
      .executeTakeFirstOrThrow();
    expect(statusRow.status).toBe("cancelled");
    expect(message.edit).toHaveBeenCalled();

    const rating = await store.getRating("guild-1", "user-1");
    expect(rating).toBe(1500);
  });

  it("returns active challenge summaries for users", async () => {
    const store = new StoreService(db, mockCodeforces as never);
    await store.insertUser("guild-1", "user-1", "tourist");
    await store.insertUser("guild-1", "user-2", "petr");

    const service = new ChallengeService(db, store, mockCodeforces as never);

    await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      hostUserId: "user-1",
      problem: { contestId: 1000, index: "A", name: "Test", rating: 1200 },
      lengthMinutes: 40,
      participants: ["user-1", "user-2"],
      startedAt: 1000,
    });

    const summaries = await service.getActiveChallengesForUsers("guild-1", ["user-1", "user-2"]);
    expect(summaries.size).toBe(2);
    expect(summaries.get("user-1")?.channelId).toBe("channel-1");
  });

  it("returns empty map when users have no active challenges", async () => {
    const store = new StoreService(db, mockCodeforces as never);
    const service = new ChallengeService(db, store, mockCodeforces as never);

    const summaries = await service.getActiveChallengesForUsers("guild-1", ["user-1"]);
    expect(summaries.size).toBe(0);
  });

  it("returns active challenges for a user", async () => {
    const store = new StoreService(db, mockCodeforces as never);
    await store.insertUser("guild-1", "user-1", "tourist");
    await store.insertUser("guild-1", "user-2", "petr");

    const service = new ChallengeService(db, store, mockCodeforces as never);

    await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      hostUserId: "user-1",
      problem: { contestId: 1000, index: "A", name: "Test", rating: 1200 },
      lengthMinutes: 40,
      participants: ["user-1"],
      startedAt: 1000,
    });

    await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-2",
      messageId: "message-2",
      hostUserId: "user-2",
      problem: { contestId: 1201, index: "B", name: "Test 2", rating: 1300 },
      lengthMinutes: 40,
      participants: ["user-2"],
      startedAt: 1000,
    });

    const userChallenges = await service.listActiveChallengesForUser("guild-1", "user-1");
    expect(userChallenges).toHaveLength(1);
    expect(userChallenges[0]?.channelId).toBe("channel-1");
  });

  it("lists recent completed challenges in descending completion order", async () => {
    const store = new StoreService(db, mockCodeforces as never);
    await store.insertUser("guild-1", "user-1", "tourist");
    await store.insertUser("guild-1", "user-2", "petr");

    const service = new ChallengeService(db, store, mockCodeforces as never);

    const firstId = await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      hostUserId: "user-1",
      problem: { contestId: 1000, index: "A", name: "Test", rating: 1200 },
      lengthMinutes: 40,
      participants: ["user-1"],
      startedAt: 1000,
    });
    const secondId = await service.createChallenge({
      serverId: "guild-1",
      channelId: "channel-2",
      messageId: "message-2",
      hostUserId: "user-2",
      problem: { contestId: 1200, index: "B", name: "Test 2", rating: 1300 },
      lengthMinutes: 40,
      participants: ["user-2"],
      startedAt: 2000,
    });

    await db
      .updateTable("challenges")
      .set({ status: "completed", updated_at: "2024-01-02T00:00:00.000Z" })
      .where("id", "=", firstId)
      .execute();
    await db
      .updateTable("challenges")
      .set({ status: "completed", updated_at: "2024-01-03T00:00:00.000Z" })
      .where("id", "=", secondId)
      .execute();
    await db
      .updateTable("challenge_participants")
      .set({ solved_at: 1100, rating_delta: 10 })
      .where("challenge_id", "=", firstId)
      .execute();

    const recent = await service.listRecentCompletedChallenges("guild-1", 2);

    expect(recent).toHaveLength(2);
    expect(recent[0]?.id).toBe(secondId);
    expect(recent[1]?.id).toBe(firstId);
    expect(recent[1]?.participants).toHaveLength(1);
    expect(recent[1]?.completedAt).toBe(Math.floor(Date.parse("2024-01-02T00:00:00.000Z") / 1000));
  });
});
