import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("challenges")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.notNull())
    .addColumn("server_id", "text", (col) => col.notNull())
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("message_id", "text", (col) => col.notNull())
    .addColumn("host_user_id", "text", (col) => col.notNull())
    .addColumn("problem_contest_id", "integer", (col) => col.notNull())
    .addColumn("problem_index", "text", (col) => col.notNull())
    .addColumn("problem_name", "text", (col) => col.notNull())
    .addColumn("problem_rating", "integer", (col) => col.notNull())
    .addColumn("length_minutes", "integer", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("started_at", "integer", (col) => col.notNull())
    .addColumn("ends_at", "integer", (col) => col.notNull())
    .addColumn("check_index", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("challenges_pk", ["id"])
    .execute();

  await db.schema
    .createIndex("challenges_status_idx")
    .ifNotExists()
    .on("challenges")
    .columns(["status"])
    .execute();

  await db.schema
    .createIndex("challenges_server_status_idx")
    .ifNotExists()
    .on("challenges")
    .columns(["server_id", "status"])
    .execute();

  await db.schema
    .createTable("challenge_participants")
    .ifNotExists()
    .addColumn("challenge_id", "text", (col) => col.notNull())
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("solved_at", "integer")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("challenge_participants_pk", ["challenge_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("challenge_participants_challenge_idx")
    .ifNotExists()
    .on("challenge_participants")
    .columns(["challenge_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("challenge_participants").ifExists().execute();
  await db.schema.dropTable("challenges").ifExists().execute();
}
