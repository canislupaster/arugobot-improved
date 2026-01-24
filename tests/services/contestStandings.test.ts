import { createHash } from "node:crypto";

import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import type { CodeforcesClient } from "../../src/services/codeforces.js";
import { ContestStandingsService } from "../../src/services/contestStandings.js";

const hashHandles = (handles: string[]): string =>
  createHash("sha1")
    .update(
      handles
        .map((handle) => handle.toLowerCase())
        .sort()
        .join("|")
    )
    .digest("hex");

describe("ContestStandingsService", () => {
  let db: Kysely<Database>;
  let client: jest.Mocked<Pick<CodeforcesClient, "request">>;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    client = {
      request: jest.fn(),
    };
  });

  afterEach(async () => {
    await db.destroy();
    jest.restoreAllMocks();
  });

  it("uses cached standings when fresh", async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    const handles = ["tourist"];
    const entries = [
      {
        handle: "tourist",
        rank: 1,
        points: 100,
        penalty: 0,
        participantType: "CONTESTANT",
      },
    ];
    await db
      .insertInto("contest_standings_cache")
      .values({
        contest_id: 123,
        handles_hash: hashHandles(handles),
        handles: JSON.stringify(handles),
        payload: JSON.stringify(entries),
        last_fetched: new Date(now).toISOString(),
      })
      .execute();

    const service = new ContestStandingsService(db, client);
    const result = await service.getStandings(123, handles, "FINISHED");

    expect(client.request).not.toHaveBeenCalled();
    expect(result.source).toBe("cache");
    expect(result.isStale).toBe(false);
    expect(result.entries).toHaveLength(1);
  });

  it("falls back to stale cache on API errors", async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    const handles = ["tourist"];
    const entries = [
      {
        handle: "tourist",
        rank: 2,
        points: 90,
        penalty: 120,
        participantType: "VIRTUAL",
      },
    ];
    await db
      .insertInto("contest_standings_cache")
      .values({
        contest_id: 456,
        handles_hash: hashHandles(handles),
        handles: JSON.stringify(handles),
        payload: JSON.stringify(entries),
        last_fetched: new Date(now - 10 * 60 * 1000).toISOString(),
      })
      .execute();

    client.request.mockRejectedValue(new Error("CF down"));

    const service = new ContestStandingsService(db, client);
    const result = await service.getStandings(456, handles, "BEFORE");

    expect(result.source).toBe("cache");
    expect(result.isStale).toBe(true);
    expect(result.entries[0]?.participantType).toBe("VIRTUAL");
  });

  it("stores results after a successful API response", async () => {
    const handles = ["tourist", "petr"];
    client.request.mockResolvedValue({
      rows: [
        {
          party: { members: [{ handle: "tourist" }], participantType: "CONTESTANT" },
          rank: 1,
          points: 100,
          penalty: 0,
        },
        {
          party: { members: [{ handle: "petr" }], participantType: "CONTESTANT" },
          rank: 2,
          points: 95.5,
          penalty: 50,
        },
      ],
    });

    const service = new ContestStandingsService(db, client);
    const result = await service.getStandings(789, handles, "CODING");

    expect(result.source).toBe("api");
    const cacheRows = await db
      .selectFrom("contest_standings_cache")
      .select(["contest_id", "handles_hash", "payload"])
      .execute();
    expect(cacheRows).toHaveLength(1);
    expect(cacheRows[0]?.contest_id).toBe(789);
    expect(cacheRows[0]?.handles_hash).toBe(hashHandles(handles));
    expect(cacheRows[0]?.payload).toContain("tourist");
  });
});
