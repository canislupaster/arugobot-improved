import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError } from "../utils/logger.js";

export type DashboardSettings = {
  guildId: string;
  isPublic: boolean;
  updatedAt: string;
};

export class GuildSettingsService {
  constructor(private readonly db: Kysely<Database>) {}

  async getDashboardSettings(guildId: string): Promise<DashboardSettings | null> {
    try {
      const row = await this.db
        .selectFrom("guild_settings")
        .select(["guild_id", "dashboard_public", "updated_at"])
        .where("guild_id", "=", guildId)
        .executeTakeFirst();
      if (!row) {
        return null;
      }
      return {
        guildId: row.guild_id,
        isPublic: Number(row.dashboard_public) === 1,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      logError(`Database error (guild settings): ${String(error)}`);
      return null;
    }
  }

  async isDashboardPublic(guildId: string): Promise<boolean> {
    const settings = await this.getDashboardSettings(guildId);
    return settings?.isPublic ?? false;
  }

  async setDashboardPublic(guildId: string, isPublic: boolean): Promise<void> {
    const timestamp = new Date().toISOString();
    try {
      await this.db
        .insertInto("guild_settings")
        .values({
          guild_id: guildId,
          dashboard_public: isPublic ? 1 : 0,
          updated_at: timestamp,
        })
        .onConflict((oc) =>
          oc.column("guild_id").doUpdateSet({
            dashboard_public: isPublic ? 1 : 0,
            updated_at: timestamp,
          })
        )
        .execute();
    } catch (error) {
      logError(`Database error (guild settings update): ${String(error)}`);
    }
  }

  async clearDashboardSettings(guildId: string): Promise<void> {
    try {
      await this.db.deleteFrom("guild_settings").where("guild_id", "=", guildId).execute();
    } catch (error) {
      logError(`Database error (guild settings clear): ${String(error)}`);
    }
  }

  async listPublicGuildIds(): Promise<string[]> {
    try {
      const rows = await this.db
        .selectFrom("guild_settings")
        .select("guild_id")
        .where("dashboard_public", "=", 1)
        .execute();
      return rows.map((row) => row.guild_id);
    } catch (error) {
      logError(`Database error (guild settings list): ${String(error)}`);
      return [];
    }
  }
}
