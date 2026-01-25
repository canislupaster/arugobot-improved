import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { CodeforcesCacheService } from "../../src/services/codeforcesCache.js";
import { ContestService } from "../../src/services/contests.js";

const mockClient = {
  request: jest.fn(),
};

describe("ContestService", () => {
  let db: Kysely<Database>;
  let cache: CodeforcesCacheService;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    cache = new CodeforcesCacheService(db);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    mockClient.request.mockReset();
    await db.destroy();
  });

  it("returns upcoming and ongoing contests sorted by start time", async () => {
    const nowMs = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(nowMs);
    const nowSeconds = Math.floor(nowMs / 1000);

    mockClient.request.mockResolvedValueOnce([
      {
        id: 1,
        name: "Contest A",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 7200,
        durationSeconds: 7200,
      },
      {
        id: 2,
        name: "Contest B",
        phase: "CODING",
        startTimeSeconds: nowSeconds - 3600,
        durationSeconds: 7200,
      },
      {
        id: 3,
        name: "Contest C",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 3600,
        durationSeconds: 7200,
      },
    ]);

    const service = new ContestService(mockClient as never, cache);
    await service.refresh(true);

    const upcoming = service.getUpcoming(2);
    expect(upcoming.map((contest) => contest.id)).toEqual([3, 1]);

    const upcomingAll = service.getUpcomingContests();
    expect(upcomingAll.map((contest) => contest.id)).toEqual([3, 1]);

    const ongoing = service.getOngoing();
    expect(ongoing).toHaveLength(1);
    expect(ongoing[0]?.id).toBe(2);
  });

  it("uses cached contests when the API fails", async () => {
    const nowMs = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(nowMs);
    const nowSeconds = Math.floor(nowMs / 1000);
    await cache.set("contest_list", [
      {
        id: 10,
        name: "Cached Contest",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 3600,
        durationSeconds: 7200,
      },
    ]);

    mockClient.request.mockRejectedValueOnce(new Error("CF down"));

    const service = new ContestService(mockClient as never, cache);
    await expect(service.refresh(true)).rejects.toThrow("CF down");

    const upcoming = service.getUpcoming(1);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.id).toBe(10);
  });

  it("finds contests by id and name", async () => {
    mockClient.request.mockResolvedValueOnce([
      {
        id: 1,
        name: "Codeforces Round #1",
        phase: "FINISHED",
        startTimeSeconds: 1_500_000_000,
        durationSeconds: 7200,
      },
      {
        id: 2,
        name: "Codeforces Round #2",
        phase: "BEFORE",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
      },
      {
        id: 3,
        name: "Educational Codeforces Round 3",
        phase: "BEFORE",
        startTimeSeconds: 1_650_000_000,
        durationSeconds: 7200,
      },
    ]);

    const service = new ContestService(mockClient as never, cache);
    await service.refresh(true);

    expect(service.getContestById(2)?.name).toBe("Codeforces Round #2");
    const matches = service.searchContests("codeforces round", 2);
    expect(matches.map((contest) => contest.id)).toEqual([2, 3]);
  });

  it("returns the most recent finished contest", async () => {
    mockClient.request.mockResolvedValueOnce([
      {
        id: 1,
        name: "Codeforces Round #1",
        phase: "FINISHED",
        startTimeSeconds: 1_500_000_000,
        durationSeconds: 7200,
      },
      {
        id: 2,
        name: "Codeforces Round #2",
        phase: "FINISHED",
        startTimeSeconds: 1_600_000_000,
        durationSeconds: 7200,
      },
      {
        id: 3,
        name: "Codeforces Round #3",
        phase: "BEFORE",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
      },
    ]);

    const service = new ContestService(mockClient as never, cache);
    await service.refresh(true);

    expect(service.getLatestFinished()?.id).toBe(2);
  });

  it("returns finished contests filtered by recency", async () => {
    mockClient.request.mockResolvedValueOnce([
      {
        id: 1,
        name: "Old Round",
        phase: "FINISHED",
        startTimeSeconds: 1_500_000_000,
        durationSeconds: 7200,
      },
      {
        id: 2,
        name: "Recent Round",
        phase: "FINISHED",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
      },
      {
        id: 3,
        name: "Upcoming",
        phase: "BEFORE",
        startTimeSeconds: 1_800_000_000,
        durationSeconds: 7200,
      },
    ]);

    const service = new ContestService(mockClient as never, cache);
    await service.refresh(true);

    const finished = service.getFinished(5, 1_650_000_000);
    expect(finished.map((contest) => contest.id)).toEqual([2]);
  });
});
