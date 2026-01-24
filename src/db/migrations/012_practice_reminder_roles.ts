import type { Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable("practice_reminders").addColumn("role_id", "text").execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable("practice_reminders").dropColumn("role_id").execute();
}
