import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("contest_standings_cache")
    .ifNotExists()
    .addColumn("contest_id", "integer", (col) => col.notNull())
    .addColumn("handles_hash", "text", (col) => col.notNull())
    .addColumn("handles", "text", (col) => col.notNull())
    .addColumn("payload", "text", (col) => col.notNull())
    .addColumn("last_fetched", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_standings_cache_pk", ["contest_id", "handles_hash"])
    .execute();

  await db.schema
    .createIndex("contest_standings_cache_contest_idx")
    .ifNotExists()
    .on("contest_standings_cache")
    .column("contest_id")
    .execute();

  await db.schema
    .createIndex("contest_standings_cache_last_fetched_idx")
    .ifNotExists()
    .on("contest_standings_cache")
    .column("last_fetched")
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex("contest_standings_cache_last_fetched_idx").execute();
  await db.schema.dropIndex("contest_standings_cache_contest_idx").execute();
  await db.schema.dropTable("contest_standings_cache").ifExists().execute();
}
