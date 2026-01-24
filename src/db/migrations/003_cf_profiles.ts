import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("cf_profiles")
    .ifNotExists()
    .addColumn("handle", "text", (col) => col.notNull())
    .addColumn("display_handle", "text", (col) => col.notNull())
    .addColumn("rating", "integer")
    .addColumn("rank", "text")
    .addColumn("max_rating", "integer")
    .addColumn("max_rank", "text")
    .addColumn("last_online", "integer")
    .addColumn("last_fetched", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("cf_profiles_pk", ["handle"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("cf_profiles").ifExists().execute();
}
