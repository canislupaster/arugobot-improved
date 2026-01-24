import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("contest_rating_changes")
    .ifNotExists()
    .addColumn("contest_id", "integer", (col) => col.notNull())
    .addColumn("payload", "text", (col) => col.notNull())
    .addColumn("last_fetched", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_rating_changes_pk", ["contest_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("contest_rating_changes").ifExists().execute();
}
