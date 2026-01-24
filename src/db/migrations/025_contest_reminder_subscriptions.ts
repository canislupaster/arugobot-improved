import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("contest_reminders_new")
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
    .on("contest_reminders_new")
    .columns(["guild_id"])
    .execute();

  await db.schema
    .createTable("contest_notifications_new")
    .addColumn("subscription_id", "text", (col) => col.notNull())
    .addColumn("contest_id", "integer", (col) => col.notNull())
    .addColumn("notified_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_notifications_pk", ["subscription_id", "contest_id"])
    .execute();

  await db.schema.dropIndex("contest_notifications_contest_idx").ifExists().execute();
  await db.schema
    .createIndex("contest_notifications_contest_idx")
    .on("contest_notifications_new")
    .columns(["contest_id"])
    .execute();

  await sql`
    insert into contest_reminders_new (
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
      lower(hex(randomblob(16))),
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

  await sql`
    insert into contest_notifications_new (subscription_id, contest_id, notified_at)
    select r.id, n.contest_id, n.notified_at
    from contest_notifications n
    join contest_reminders_new r on r.guild_id = n.guild_id
  `.execute(db);

  await db.schema.dropTable("contest_notifications").execute();
  await db.schema.dropTable("contest_reminders").execute();
  await db.schema.alterTable("contest_reminders_new").renameTo("contest_reminders").execute();
  await db.schema
    .alterTable("contest_notifications_new")
    .renameTo("contest_notifications")
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("contest_reminders_old")
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("minutes_before", "integer", (col) => col.notNull())
    .addColumn("role_id", "text")
    .addColumn("include_keywords", "text")
    .addColumn("exclude_keywords", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_reminders_pk", ["guild_id"])
    .execute();

  await db.schema
    .createTable("contest_notifications_old")
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("contest_id", "integer", (col) => col.notNull())
    .addColumn("notified_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_notifications_pk", ["guild_id", "contest_id"])
    .execute();

  await db.schema.dropIndex("contest_notifications_contest_idx").ifExists().execute();
  await db.schema
    .createIndex("contest_notifications_contest_idx")
    .on("contest_notifications_old")
    .columns(["contest_id"])
    .execute();

  await sql`
    insert into contest_reminders_old (
      guild_id,
      channel_id,
      minutes_before,
      role_id,
      include_keywords,
      exclude_keywords,
      created_at,
      updated_at
    )
    select r.guild_id,
      r.channel_id,
      r.minutes_before,
      r.role_id,
      r.include_keywords,
      r.exclude_keywords,
      r.created_at,
      r.updated_at
    from contest_reminders r
    join (
      select guild_id, max(updated_at) as max_updated
      from contest_reminders
      group by guild_id
    ) latest
      on latest.guild_id = r.guild_id
      and latest.max_updated = r.updated_at
  `.execute(db);

  await sql`
    insert or ignore into contest_notifications_old (guild_id, contest_id, notified_at)
    select r.guild_id, n.contest_id, n.notified_at
    from contest_notifications n
    join contest_reminders r on r.id = n.subscription_id
    join contest_reminders_old ro on ro.guild_id = r.guild_id
  `.execute(db);

  await db.schema.dropTable("contest_notifications").execute();
  await db.schema.dropTable("contest_reminders").execute();
  await db.schema.alterTable("contest_reminders_old").renameTo("contest_reminders").execute();
  await db.schema
    .alterTable("contest_notifications_old")
    .renameTo("contest_notifications")
    .execute();
}
