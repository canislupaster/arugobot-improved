import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("command_metrics")
    .ifNotExists()
    .addColumn("command", "text", (col) => col.notNull())
    .addColumn("count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("success_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("failure_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("total_latency_ms", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("max_latency_ms", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("last_seen_at", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("command_metrics_pk", ["command"])
    .execute();

  await db.schema
    .createIndex("command_metrics_last_seen_idx")
    .ifNotExists()
    .on("command_metrics")
    .columns(["last_seen_at"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("command_metrics").ifExists().execute();
}
