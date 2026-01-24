import type { Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable("challenge_participants")
    .addColumn("rating_before", "integer")
    .execute();

  await db.schema
    .alterTable("challenge_participants")
    .addColumn("rating_delta", "integer")
    .execute();

  await db.schema
    .createIndex("challenge_participants_user_idx")
    .ifNotExists()
    .on("challenge_participants")
    .columns(["user_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex("challenge_participants_user_idx").ifExists().execute();
  await db.schema.alterTable("challenge_participants").dropColumn("rating_before").execute();

  await db.schema.alterTable("challenge_participants").dropColumn("rating_delta").execute();
}
