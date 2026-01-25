import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { InstanceLockService } from "../../src/services/instanceLocks.js";

describe("InstanceLockService", () => {
  let db: Kysely<Database>;
  let service: InstanceLockService;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    service = new InstanceLockService(db);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    await db.destroy();
  });

  it("acquires a new lock and returns it", async () => {
    const result = await service.acquireLock("bot", "owner-1", 123, 60);
    expect(result.acquired).toBe(true);
    expect(result.lock?.ownerId).toBe("owner-1");

    const stored = await service.getLock("bot");
    expect(stored?.ownerId).toBe("owner-1");
  });

  it("refuses to acquire an active lock held by another owner", async () => {
    await service.acquireLock("bot", "owner-1", 123, 60);
    const result = await service.acquireLock("bot", "owner-2", 456, 60);
    expect(result.acquired).toBe(false);
    expect(result.lock?.ownerId).toBe("owner-1");
  });

  it("takes over a stale lock", async () => {
    const baseTime = 1_700_000_000_000;
    jest.useFakeTimers().setSystemTime(baseTime);
    await service.acquireLock("bot", "owner-1", 123, 60);

    jest.setSystemTime(baseTime + 61_000);
    const result = await service.acquireLock("bot", "owner-2", 456, 60);
    expect(result.acquired).toBe(true);
    expect(result.lock?.ownerId).toBe("owner-2");
  });

  it("updates heartbeat for the current owner", async () => {
    await service.acquireLock("bot", "owner-1", 123, 60);
    const ok = await service.heartbeat("bot", "owner-1");
    expect(ok).toBe(true);
  });

  it("releases a lock for the current owner", async () => {
    await service.acquireLock("bot", "owner-1", 123, 60);
    await service.release("bot", "owner-1");
    const lock = await service.getLock("bot");
    expect(lock).toBeNull();
  });
});
