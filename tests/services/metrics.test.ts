import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import { MetricsService } from "../../src/services/metrics.js";

describe("MetricsService", () => {
  it("tracks command counts and latency in the database", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const metrics = new MetricsService(db);

    await metrics.recordCommandResult("ping", 120, true);
    await metrics.recordCommandResult("ping", 80, false);
    await metrics.recordCommandResult("help", 50, true);

    expect(await metrics.getCommandCount()).toBe(3);
    expect(await metrics.getUniqueCommandCount()).toBe(2);
    expect(await metrics.getLastCommandAt()).toEqual(expect.any(String));

    const summary = await metrics.getCommandUsageSummary(2);
    expect(summary[0]?.name).toBe("ping");
    expect(summary[0]?.count).toBe(2);
    expect(summary[0]?.successRate).toBe(50);
    expect(summary[0]?.avgLatencyMs).toBe(100);
    expect(summary[0]?.maxLatencyMs).toBe(120);

    await db.destroy();
  });

  it("returns empty summary when limit is zero", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const metrics = new MetricsService(db);

    await metrics.recordCommandResult("ping", 10, true);

    const summary = await metrics.getCommandUsageSummary(0);
    expect(summary).toEqual([]);

    await db.destroy();
  });

  it("returns a single command summary when available", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const metrics = new MetricsService(db);

    await metrics.recordCommandResult("ping", 120, true);
    await metrics.recordCommandResult("ping", 80, false);

    const summary = await metrics.getCommandSummary("ping");
    expect(summary).toEqual({
      name: "ping",
      count: 2,
      successRate: 50,
      avgLatencyMs: 100,
      maxLatencyMs: 120,
      lastSeenAt: expect.any(String),
    });

    const missing = await metrics.getCommandSummary("missing");
    expect(missing).toBeNull();

    await db.destroy();
  });
});
