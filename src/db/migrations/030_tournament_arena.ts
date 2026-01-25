import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("tournament_arena_state")
    .addColumn("tournament_id", "text", (col) => col.notNull())
    .addColumn("starts_at", "integer", (col) => col.notNull())
    .addColumn("ends_at", "integer", (col) => col.notNull())
    .addColumn("problem_count", "integer", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("tournament_arena_state_pk", ["tournament_id"])
    .execute();

  await db.schema
    .createTable("tournament_arena_problems")
    .addColumn("tournament_id", "text", (col) => col.notNull())
    .addColumn("problem_contest_id", "integer", (col) => col.notNull())
    .addColumn("problem_index", "text", (col) => col.notNull())
    .addColumn("problem_name", "text", (col) => col.notNull())
    .addColumn("problem_rating", "integer", (col) => col.notNull())
    .addColumn("problem_tags", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("tournament_arena_problems_pk", [
      "tournament_id",
      "problem_contest_id",
      "problem_index",
    ])
    .execute();

  await db.schema
    .createIndex("tournament_arena_problems_tournament_idx")
    .on("tournament_arena_problems")
    .columns(["tournament_id"])
    .execute();

  await db.schema
    .createTable("tournament_arena_solves")
    .addColumn("tournament_id", "text", (col) => col.notNull())
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("problem_contest_id", "integer", (col) => col.notNull())
    .addColumn("problem_index", "text", (col) => col.notNull())
    .addColumn("submission_id", "integer")
    .addColumn("solved_at", "integer", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("tournament_arena_solves_pk", [
      "tournament_id",
      "user_id",
      "problem_contest_id",
      "problem_index",
    ])
    .execute();

  await db.schema
    .createIndex("tournament_arena_solves_tournament_idx")
    .on("tournament_arena_solves")
    .columns(["tournament_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex("tournament_arena_solves_tournament_idx").ifExists().execute();
  await db.schema.dropTable("tournament_arena_solves").ifExists().execute();

  await db.schema.dropIndex("tournament_arena_problems_tournament_idx").ifExists().execute();
  await db.schema.dropTable("tournament_arena_problems").ifExists().execute();

  await db.schema.dropTable("tournament_arena_state").ifExists().execute();
}
