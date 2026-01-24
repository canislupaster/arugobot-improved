import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("practice_preferences")
    .ifNotExists()
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("rating_ranges", "text", (col) => col.notNull())
    .addColumn("tags", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("practice_preferences_pk", ["guild_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("practice_preferences_guild_user_idx")
    .ifNotExists()
    .on("practice_preferences")
    .columns(["guild_id", "user_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("practice_preferences").ifExists().execute();
}
