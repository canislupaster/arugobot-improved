import { type Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("practice_suggestions")
    .addColumn("guild_id", "text", (col) => col.notNull())
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("problem_id", "text", (col) => col.notNull())
    .addColumn("suggested_at", "text", (col) => col.notNull())
    .addPrimaryKeyConstraint("practice_suggestions_pk", ["guild_id", "user_id", "problem_id"])
    .execute();

  await db.schema
    .createIndex("practice_suggestions_user_idx")
    .on("practice_suggestions")
    .columns(["guild_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("practice_suggestions_suggested_at_idx")
    .on("practice_suggestions")
    .columns(["suggested_at"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex("practice_suggestions_suggested_at_idx").execute();
  await db.schema.dropIndex("practice_suggestions_user_idx").execute();
  await db.schema.dropTable("practice_suggestions").execute();
}
