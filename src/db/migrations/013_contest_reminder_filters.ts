import { type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable("contest_reminders").addColumn("include_keywords", "text").execute();
  await db.schema.alterTable("contest_reminders").addColumn("exclude_keywords", "text").execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable("contest_reminders").dropColumn("exclude_keywords").execute();
  await db.schema.alterTable("contest_reminders").dropColumn("include_keywords").execute();
}
