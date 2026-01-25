import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import { LogsService } from "../../src/services/logs.js";

describe("LogsService", () => {
  it("stores log entries with structured context", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const logs = new LogsService(db, 30);

    await logs.write({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Command received.",
      context: {
        correlationId: "abc",
        command: "ping",
        guildId: "guild-1",
        userId: "user-1",
        latencyMs: 123,
        detail: "extra",
      },
    });

    const row = await db
      .selectFrom("log_entries")
      .select(["command", "correlation_id", "context_json"])
      .executeTakeFirst();

    expect(row?.command).toBe("ping");
    expect(row?.correlation_id).toBe("abc");
    expect(row?.context_json).toContain("detail");

    await db.destroy();
  });

  it("cleans up old log entries based on retention", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const logs = new LogsService(db, 1);

    const oldTimestamp = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const freshTimestamp = new Date().toISOString();

    await logs.write({
      timestamp: oldTimestamp,
      level: "warn",
      message: "Old entry.",
    });
    await logs.write({
      timestamp: freshTimestamp,
      level: "info",
      message: "Fresh entry.",
    });

    const deleted = await logs.cleanupOldEntries();
    expect(deleted).toBe(1);
    expect(await logs.getCount()).toBe(1);

    await db.destroy();
  });
});
