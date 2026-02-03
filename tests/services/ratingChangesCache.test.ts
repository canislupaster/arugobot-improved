import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import {
  readRatingChangesCache,
  writeRatingChangesCache,
} from "../../src/services/ratingChangesCache.js";

describe("ratingChangesCache", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("writes and reads handle cache rows", async () => {
    const payload = JSON.stringify([{ contestId: 1 }]);
    const timestamp = "2024-01-01T00:00:00.000Z";

    await writeRatingChangesCache(
      db,
      { type: "handle", handle: "tourist" },
      payload,
      timestamp
    );

    const cached = await readRatingChangesCache(db, {
      type: "handle",
      handle: "tourist",
    });

    expect(cached?.payload).toBe(payload);
    expect(cached?.last_fetched).toBe(timestamp);
  });

  it("writes and reads contest cache rows", async () => {
    const payload = JSON.stringify([{ contestId: 2 }]);
    const timestamp = "2024-01-02T00:00:00.000Z";

    await writeRatingChangesCache(
      db,
      { type: "contest", contestId: 1234 },
      payload,
      timestamp
    );

    const cached = await readRatingChangesCache(db, {
      type: "contest",
      contestId: 1234,
    });

    expect(cached?.payload).toBe(payload);
    expect(cached?.last_fetched).toBe(timestamp);
  });

  it("returns null for missing cache rows", async () => {
    const cached = await readRatingChangesCache(db, {
      type: "contest",
      contestId: 9999,
    });

    expect(cached).toBeNull();
  });
});
