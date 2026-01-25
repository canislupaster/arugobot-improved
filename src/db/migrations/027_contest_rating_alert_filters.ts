import type { Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable("contest_rating_alert_subscriptions")
    .addColumn("min_delta", "integer", (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .alterTable("contest_rating_alert_subscriptions")
    .addColumn("include_handles", "text")
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable("contest_rating_alert_subscriptions")
    .dropColumn("min_delta")
    .execute();

  await db.schema
    .alterTable("contest_rating_alert_subscriptions")
    .dropColumn("include_handles")
    .execute();
}
