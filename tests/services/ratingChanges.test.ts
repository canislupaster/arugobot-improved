import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { RatingChangesService } from "../../src/services/ratingChanges.js";

const mockClient = {
  request: jest.fn(),
};

const mockChanges = [
  {
    contestId: 1234,
    contestName: "Codeforces Round #1234",
    rank: 42,
    oldRating: 1500,
    newRating: 1575,
    ratingUpdateTimeSeconds: 1_700_000_000,
  },
];

describe("RatingChangesService", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    mockClient.request.mockReset();
    await db.destroy();
  });

  it("caches rating changes from the API", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    mockClient.request.mockResolvedValueOnce(mockChanges);

    const service = new RatingChangesService(db, mockClient as never);
    const result = await service.getRatingChanges("tourist");

    expect(result?.source).toBe("api");
    expect(result?.changes).toHaveLength(1);
    expect(mockClient.request).toHaveBeenCalledWith("user.rating", { handle: "tourist" });
    expect(service.getLastError()).toBeNull();

    const cached = await service.getRatingChanges("tourist");
    expect(cached?.source).toBe("cache");
    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });

  it("falls back to cached data when the API fails", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    await db
      .insertInto("cf_rating_changes")
      .values({
        handle: "tourist",
        payload: JSON.stringify(mockChanges),
        last_fetched: "2023-12-01T00:00:00.000Z",
      })
      .execute();

    mockClient.request.mockRejectedValueOnce(new Error("CF down"));

    const service = new RatingChangesService(db, mockClient as never);
    const result = await service.getRatingChanges("tourist", 60);

    expect(result?.source).toBe("cache");
    expect(result?.isStale).toBe(true);
    expect(service.getLastError()).toEqual({
      message: "CF down",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
  });
});
