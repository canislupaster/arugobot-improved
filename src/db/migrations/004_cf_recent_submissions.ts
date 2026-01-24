import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("cf_recent_submissions")
    .ifNotExists()
    .addColumn("handle", "text", (col) => col.notNull())
    .addColumn("submissions", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("last_fetched", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("cf_recent_submissions_pk", ["handle"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("cf_recent_submissions").ifExists().execute();
}
