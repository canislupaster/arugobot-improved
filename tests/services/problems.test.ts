import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { CodeforcesCacheService } from "../../src/services/codeforcesCache.js";
import { ProblemService } from "../../src/services/problems.js";

const mockClient = {
  request: jest.fn(),
};

type CachedProblem = {
  contestId: number;
  index: string;
  name: string;
  rating: number;
  tags: string[];
};

describe("ProblemService", () => {
  let db: Kysely<Database>;
  let cache: CodeforcesCacheService;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    cache = new CodeforcesCacheService(db);
  });

  afterEach(async () => {
    await db.destroy();
    mockClient.request.mockReset();
    jest.restoreAllMocks();
  });

  it("loads cached problems without hitting the API", async () => {
    await cache.set("problemset", [
      {
        contestId: 100,
        index: "A",
        name: "Cached",
        rating: 800,
        tags: ["dp"],
      },
    ]);
    mockClient.request.mockRejectedValue(new Error("CF down"));

    const service = new ProblemService(mockClient as never, cache);
    const problems = await service.ensureProblemsLoaded();

    expect(problems).toHaveLength(1);
    expect(problems[0]?.name).toBe("Cached");
    expect(mockClient.request).not.toHaveBeenCalled();
  });

  it("refreshes from the API and updates the cache", async () => {
    mockClient.request.mockResolvedValueOnce({
      problems: [
        {
          contestId: 200,
          index: "B",
          name: "API",
          rating: 1200,
          tags: ["math"],
        },
      ],
    });

    const service = new ProblemService(mockClient as never, cache);
    await service.refreshProblems(true);

    const cached = await cache.get<CachedProblem[]>("problemset");
    expect(cached?.value).toHaveLength(1);
    expect(cached?.value[0]?.name).toBe("API");
  });
});
