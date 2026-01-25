import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import { LOG_ENTRY_LIMIT, LogsService } from "../../src/services/logs.js";

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

  it("returns recent entries with filters", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const logs = new LogsService(db, 30);

    await logs.write({
      timestamp: "2024-01-01T00:00:00.000Z",
      level: "info",
      message: "Info entry.",
      context: { guildId: "guild-1", command: "ping", correlationId: "aaa" },
    });
    await logs.write({
      timestamp: "2024-01-02T00:00:00.000Z",
      level: "error",
      message: "Error entry.",
      context: { guildId: "guild-1", command: "health", correlationId: "bbb", userId: "user-1" },
    });
    await logs.write({
      timestamp: "2024-01-03T00:00:00.000Z",
      level: "error",
      message: "Other guild.",
      context: { guildId: "guild-2", command: "health", correlationId: "ccc" },
    });

    const entries = await logs.getRecentEntries({
      guildId: "guild-1",
      level: "error",
      correlationId: "bbb",
      userId: "user-1",
      limit: 5,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("Error entry.");

    await db.destroy();
  });

  it("clamps the log entry limit", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const logs = new LogsService(db, 30);

    const timestamp = new Date().toISOString();
    const entries = Array.from({ length: LOG_ENTRY_LIMIT + 5 }, (_, index) => ({
      timestamp,
      level: "info" as const,
      message: `Entry ${index + 1}`,
      context: { guildId: "guild-1" },
    }));

    for (const entry of entries) {
      await logs.write(entry);
    }

    const recent = await logs.getRecentEntries({ limit: LOG_ENTRY_LIMIT + 50 });

    expect(recent).toHaveLength(LOG_ENTRY_LIMIT);

    await db.destroy();
  });
});
