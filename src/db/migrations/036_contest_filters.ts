import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("contest_filters")
    .ifNotExists()
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("include_keywords", "text")
    .addColumn("exclude_keywords", "text")
    .addColumn("scope", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("contest_filters_pk", ["guild_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("contest_filters").ifExists().execute();
}
