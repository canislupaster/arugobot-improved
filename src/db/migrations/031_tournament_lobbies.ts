import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("tournament_lobbies")
    .addColumn("id", "text", (col) => col.notNull())
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("host_user_id", "text", (col) => col.notNull())
    .addColumn("format", "text", (col) => col.notNull())
    .addColumn("length_minutes", "integer", (col) => col.notNull())
    .addColumn("max_participants", "integer", (col) => col.notNull())
    .addColumn("rating_ranges", "text", (col) => col.notNull())
    .addColumn("tags", "text", (col) => col.notNull())
    .addColumn("swiss_rounds", "integer")
    .addColumn("arena_problem_count", "integer")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("tournament_lobbies_pk", ["id"])
    .execute();

  await db.schema
    .createIndex("tournament_lobbies_guild_idx")
    .on("tournament_lobbies")
    .columns(["guild_id"])
    .unique()
    .execute();

  await db.schema
    .createTable("tournament_lobby_participants")
    .addColumn("lobby_id", "text", (col) => col.notNull())
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("tournament_lobby_participants_pk", ["lobby_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("tournament_lobby_participants_lobby_idx")
    .on("tournament_lobby_participants")
    .columns(["lobby_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("tournament_lobby_participants").ifExists().execute();
  await db.schema.dropTable("tournament_lobbies").ifExists().execute();
}
