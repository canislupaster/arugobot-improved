import { type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("log_entries")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("timestamp", "text", (col) => col.notNull())
    .addColumn("level", "text", (col) => col.notNull())
    .addColumn("message", "text", (col) => col.notNull())
    .addColumn("correlation_id", "text")
    .addColumn("command", "text")
    .addColumn("guild_id", "text")
    .addColumn("user_id", "text")
    .addColumn("latency_ms", "integer")
    .addColumn("context_json", "text")
    .execute();

  await db.schema
    .createIndex("log_entries_timestamp_idx")
    .ifNotExists()
    .on("log_entries")
    .columns(["timestamp"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex("log_entries_timestamp_idx").ifExists().execute();
  await db.schema.dropTable("log_entries").ifExists().execute();
}
