import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError } from "../utils/logger.js";

import type { ContestScopeFilter } from "./contests.js";

export type ContestFilterSettings = {
  guildId: string;
  includeKeywords: string | null;
  excludeKeywords: string | null;
  scope: ContestScopeFilter | null;
  updatedAt: string;
};

export class ContestFilterService {
  constructor(private readonly db: Kysely<Database>) {}

  async getSettings(guildId: string): Promise<ContestFilterSettings | null> {
    try {
      const row = await this.db
        .selectFrom("contest_filters")
        .select(["guild_id", "include_keywords", "exclude_keywords", "scope", "updated_at"])
        .where("guild_id", "=", guildId)
        .executeTakeFirst();
      if (!row) {
        return null;
      }
      return {
        guildId: row.guild_id,
        includeKeywords: row.include_keywords ?? null,
        excludeKeywords: row.exclude_keywords ?? null,
        scope: (row.scope as ContestScopeFilter | null) ?? null,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      logError(`Database error (contest filters): ${String(error)}`);
      return null;
    }
  }

  async setSettings(
    guildId: string,
    settings: {
      includeKeywords: string | null;
      excludeKeywords: string | null;
      scope: ContestScopeFilter | null;
    }
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    try {
      await this.db
        .insertInto("contest_filters")
        .values({
          guild_id: guildId,
          include_keywords: settings.includeKeywords,
          exclude_keywords: settings.excludeKeywords,
          scope: settings.scope,
          updated_at: timestamp,
        })
        .onConflict((oc) =>
          oc.column("guild_id").doUpdateSet({
            include_keywords: settings.includeKeywords,
            exclude_keywords: settings.excludeKeywords,
            scope: settings.scope,
            updated_at: timestamp,
          })
        )
        .execute();
    } catch (error) {
      logError(`Database error (contest filters update): ${String(error)}`);
    }
  }

  async clearSettings(guildId: string): Promise<void> {
    try {
      await this.db.deleteFrom("contest_filters").where("guild_id", "=", guildId).execute();
    } catch (error) {
      logError(`Database error (contest filters clear): ${String(error)}`);
    }
  }
}
