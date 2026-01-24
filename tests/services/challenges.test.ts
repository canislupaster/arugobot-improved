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
      .select("solved_at")
      .where(
        "challenge_id",
        "=",
        (await db.selectFrom("challenges").select("id").executeTakeFirstOrThrow()).id
      )
      .where("user_id", "=", "user-1")
      .executeTakeFirst();
    expect(row?.solved_at).not.toBeNull();
    expect(message.edit).toHaveBeenCalled();
    expect(down).toBeLessThan(0);
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
});
