import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("contest_rating_alert_subscriptions")
    .addColumn("id", "text", (col) => col.notNull())
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("role_id", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_rating_alert_subscriptions_pk", ["id"])
    .execute();

  await db.schema
    .createIndex("contest_rating_alert_subscriptions_guild_idx")
    .on("contest_rating_alert_subscriptions")
    .columns(["guild_id"])
    .execute();

  await db.schema
    .createTable("contest_rating_alert_notifications")
    .addColumn("subscription_id", "text", (col) => col.notNull())
    .addColumn("contest_id", "integer", (col) => col.notNull())
    .addColumn("notified_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_rating_alert_notifications_pk", [
      "subscription_id",
      "contest_id",
    ])
    .execute();

  await db.schema
    .createIndex("contest_rating_alert_notifications_contest_idx")
    .on("contest_rating_alert_notifications")
    .columns(["contest_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex("contest_rating_alert_notifications_contest_idx").ifExists().execute();
  await db.schema.dropTable("contest_rating_alert_notifications").execute();
  await db.schema.dropIndex("contest_rating_alert_subscriptions_guild_idx").ifExists().execute();
  await db.schema.dropTable("contest_rating_alert_subscriptions").execute();
}
