import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("cf_handles")
    .ifNotExists()
    .addColumn("handle", "text", (col) => col.notNull())
    .addColumn("canonical_handle", "text")
    .addColumn("exists", "integer", (col) => col.notNull())
    .addColumn("last_checked", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("cf_handles_pk", ["handle"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("cf_handles").ifExists().execute();
}
