import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("practice_reminders")
    .ifNotExists()
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("hour_utc", "integer", (col) => col.notNull())
    .addColumn("minute_utc", "integer", (col) => col.notNull())
    .addColumn("rating_ranges", "text", (col) => col.notNull())
    .addColumn("tags", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("last_sent_at", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("practice_reminders_pk", ["guild_id"])
    .execute();

  await db.schema
    .createIndex("practice_reminders_channel_idx")
    .ifNotExists()
    .on("practice_reminders")
    .columns(["channel_id"])
    .execute();

  await db.schema
    .createTable("practice_posts")
    .ifNotExists()
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("problem_id", "text", (col) => col.notNull())
    .addColumn("sent_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("practice_posts_pk", ["guild_id", "problem_id"])
    .execute();

  await db.schema
    .createIndex("practice_posts_guild_idx")
    .ifNotExists()
    .on("practice_posts")
    .columns(["guild_id"])
    .execute();

  await db.schema
    .createIndex("practice_posts_sent_idx")
    .ifNotExists()
    .on("practice_posts")
    .columns(["sent_at"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("practice_posts").ifExists().execute();
  await db.schema.dropTable("practice_reminders").ifExists().execute();
}
