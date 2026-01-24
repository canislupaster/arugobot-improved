import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("users")
    .ifNotExists()
    .addColumn("server_id", "text", (col) => col.notNull())
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("handle", "text", (col) => col.notNull())
    .addColumn("rating", "integer", (col) => col.notNull())
    .addColumn("history", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("rating_history", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("users_pk", ["server_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("users_server_handle_idx")
    .ifNotExists()
    .on("users")
    .columns(["server_id", "handle"])
    .execute();

  await db.schema
    .createIndex("users_server_user_idx")
    .ifNotExists()
    .on("users")
    .columns(["server_id", "user_id"])
    .execute();

  await db.schema
    .createTable("ac")
    .ifNotExists()
    .addColumn("handle", "text", (col) => col.notNull())
    .addColumn("solved", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("last_sub", "integer", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("ac_pk", ["handle"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("ac").ifExists().execute();
  await db.schema.dropTable("users").ifExists().execute();
}
