import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("instance_locks")
    .ifNotExists()
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("owner_id", "text", (col) => col.notNull())
    .addColumn("pid", "integer", (col) => col.notNull())
    .addColumn("started_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("heartbeat_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("instance_locks_pk", ["name"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("instance_locks").ifExists().execute();
}
