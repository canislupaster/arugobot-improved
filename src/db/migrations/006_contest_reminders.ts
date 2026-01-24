import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("contest_reminders")
    .ifNotExists()
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("minutes_before", "integer", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_reminders_pk", ["guild_id"])
    .execute();

  await db.schema
    .createTable("contest_notifications")
    .ifNotExists()
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("contest_id", "integer", (col) => col.notNull())
    .addColumn("notified_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_notifications_pk", ["guild_id", "contest_id"])
    .execute();

  await db.schema
    .createIndex("contest_notifications_contest_idx")
    .ifNotExists()
    .on("contest_notifications")
    .columns(["contest_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("contest_notifications").ifExists().execute();
  await db.schema.dropTable("contest_reminders").ifExists().execute();
}
