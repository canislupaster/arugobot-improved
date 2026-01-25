import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable("contest_reminders")
    .addColumn("scope", "text", (col) => col.notNull().defaultTo("official"))
    .execute();

  await db.schema
    .createIndex("contest_reminders_scope_idx")
    .ifNotExists()
    .on("contest_reminders")
    .columns(["scope"])
    .execute();

  await db
    .updateTable("contest_reminders")
    .set({ scope: "official" })
    .where("scope", "is", null)
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("contest_reminders_old")
    .addColumn("id", "text", (col) => col.notNull())
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("minutes_before", "integer", (col) => col.notNull())
    .addColumn("role_id", "text")
    .addColumn("include_keywords", "text")
    .addColumn("exclude_keywords", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_reminders_pk", ["id"])
    .execute();

  await db.schema
    .createIndex("contest_reminders_guild_idx")
    .on("contest_reminders_old")
    .columns(["guild_id"])
    .execute();

  await sql`
    insert into contest_reminders_old (
      id,
      guild_id,
      channel_id,
      minutes_before,
      role_id,
      include_keywords,
      exclude_keywords,
      created_at,
      updated_at
    )
    select
      id,
      guild_id,
      channel_id,
      minutes_before,
      role_id,
      include_keywords,
      exclude_keywords,
      created_at,
      updated_at
    from contest_reminders
  `.execute(db);

  await db.schema.dropTable("contest_reminders").execute();
  await db.schema.alterTable("contest_reminders_old").renameTo("contest_reminders").execute();
  await db.schema.dropIndex("contest_reminders_scope_idx").ifExists().execute();
}
