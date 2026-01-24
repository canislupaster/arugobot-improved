import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("tournaments")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.notNull())
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("host_user_id", "text", (col) => col.notNull())
    .addColumn("format", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("length_minutes", "integer", (col) => col.notNull())
    .addColumn("round_count", "integer", (col) => col.notNull())
    .addColumn("current_round", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("rating_ranges", "text", (col) => col.notNull())
    .addColumn("tags", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("tournaments_pk", ["id"])
    .execute();

  await db.schema
    .createIndex("tournaments_guild_status_idx")
    .ifNotExists()
    .on("tournaments")
    .columns(["guild_id", "status"])
    .execute();

  await db.schema
    .createTable("tournament_participants")
    .ifNotExists()
    .addColumn("tournament_id", "text", (col) => col.notNull())
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("seed", "integer", (col) => col.notNull())
    .addColumn("score", "real", (col) => col.notNull().defaultTo(0))
    .addColumn("wins", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("losses", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("draws", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("eliminated", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("tournament_participants_pk", ["tournament_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("tournament_participants_tournament_idx")
    .ifNotExists()
    .on("tournament_participants")
    .columns(["tournament_id"])
    .execute();

  await db.schema
    .createTable("tournament_rounds")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.notNull())
    .addColumn("tournament_id", "text", (col) => col.notNull())
    .addColumn("round_number", "integer", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("problem_contest_id", "integer", (col) => col.notNull())
    .addColumn("problem_index", "text", (col) => col.notNull())
    .addColumn("problem_name", "text", (col) => col.notNull())
    .addColumn("problem_rating", "integer", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("tournament_rounds_pk", ["id"])
    .execute();

  await db.schema
    .createIndex("tournament_rounds_tournament_round_idx")
    .ifNotExists()
    .on("tournament_rounds")
    .columns(["tournament_id", "round_number"])
    .execute();

  await db.schema
    .createTable("tournament_matches")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.notNull())
    .addColumn("tournament_id", "text", (col) => col.notNull())
    .addColumn("round_id", "text", (col) => col.notNull())
    .addColumn("match_number", "integer", (col) => col.notNull())
    .addColumn("challenge_id", "text")
    .addColumn("player1_id", "text", (col) => col.notNull())
    .addColumn("player2_id", "text")
    .addColumn("winner_id", "text")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("tournament_matches_pk", ["id"])
    .execute();

  await db.schema
    .createIndex("tournament_matches_tournament_round_idx")
    .ifNotExists()
    .on("tournament_matches")
    .columns(["tournament_id", "round_id"])
    .execute();

  await db.schema
    .createIndex("tournament_matches_challenge_idx")
    .ifNotExists()
    .on("tournament_matches")
    .columns(["challenge_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("tournament_matches").ifExists().execute();
  await db.schema.dropTable("tournament_rounds").ifExists().execute();
  await db.schema.dropTable("tournament_participants").ifExists().execute();
  await db.schema.dropTable("tournaments").ifExists().execute();
}
