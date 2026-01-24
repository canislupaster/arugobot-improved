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
});
