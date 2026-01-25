import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("cf_contest_submissions")
    .ifNotExists()
    .addColumn("contest_id", "integer", (col) => col.notNull())
    .addColumn("submissions", "text", (col) => col.notNull())
    .addColumn("last_submission_id", "integer")
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("cf_contest_submissions_pk", ["contest_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("cf_contest_submissions").ifExists().execute();
}
