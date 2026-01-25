import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("weekly_digests")
    .ifNotExists()
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("day_of_week", "integer", (col) => col.notNull())
    .addColumn("hour_utc", "integer", (col) => col.notNull())
    .addColumn("minute_utc", "integer", (col) => col.notNull())
    .addColumn("utc_offset_minutes", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("role_id", "text")
    .addColumn("last_sent_at", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("weekly_digests_pk", ["guild_id"])
    .execute();

  await db.schema
    .createIndex("weekly_digests_channel_idx")
    .ifNotExists()
    .on("weekly_digests")
    .columns(["channel_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("weekly_digests").ifExists().execute();
}
