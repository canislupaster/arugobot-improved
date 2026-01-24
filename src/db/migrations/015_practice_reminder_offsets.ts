import { type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable("practice_reminders")
    .addColumn("utc_offset_minutes", "integer", (col) => col.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable("practice_reminders").dropColumn("utc_offset_minutes").execute();
}
