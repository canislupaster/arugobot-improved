import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("guild_settings")
    .ifNotExists()
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("dashboard_public", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("guild_settings_pk", ["guild_id"])
    .execute();

  await db.schema
    .createIndex("guild_settings_dashboard_public_idx")
    .ifNotExists()
    .on("guild_settings")
    .columns(["dashboard_public"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("guild_settings").ifExists().execute();
}
