import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("cf_rating_changes")
    .ifNotExists()
    .addColumn("handle", "text", (col) => col.notNull())
    .addColumn("payload", "text", (col) => col.notNull())
    .addColumn("last_fetched", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("cf_rating_changes_pk", ["handle"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("cf_rating_changes").ifExists().execute();
}
