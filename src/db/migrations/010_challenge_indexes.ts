import type { Kysely } from "kysely";

import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createIndex("challenges_server_status_updated_idx")
    .ifNotExists()
    .on("challenges")
    .columns(["server_id", "status", "updated_at"])
    .execute();

  await db.schema
    .createIndex("challenge_participants_user_idx")
    .ifNotExists()
    .on("challenge_participants")
    .columns(["user_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex("challenges_server_status_updated_idx").ifExists().execute();
  await db.schema.dropIndex("challenge_participants_user_idx").ifExists().execute();
}
