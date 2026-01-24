import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logWarn } from "../utils/logger.js";

export type CacheKey = "problemset" | "contest_list";

export type CacheEntry<T> = {
  value: T;
  lastFetched: string;
};

export type CodeforcesCache = {
  get<T>(key: CacheKey): Promise<CacheEntry<T> | null>;
  set<T>(key: CacheKey, value: T): Promise<void>;
};

export class NoopCodeforcesCache implements CodeforcesCache {
  async get<T>(_key: CacheKey): Promise<CacheEntry<T> | null> {
    return null;
  }

  async set<T>(_key: CacheKey, _value: T): Promise<void> {
    return;
  }
}

export class CodeforcesCacheService implements CodeforcesCache {
  constructor(private db: Kysely<Database>) {}

  async get<T>(key: CacheKey): Promise<CacheEntry<T> | null> {
    const row = await this.db
      .selectFrom("cf_cache")
      .select(["payload", "last_fetched"])
      .where("key", "=", key)
      .executeTakeFirst();
    if (!row) {
      return null;
    }

    try {
      const parsed = JSON.parse(row.payload) as T;
      return { value: parsed, lastFetched: row.last_fetched };
    } catch (error) {
      logWarn("Failed to parse cached Codeforces payload.", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async set<T>(key: CacheKey, value: T): Promise<void> {
    const payload = JSON.stringify(value);
    const timestamp = new Date().toISOString();
    await this.db
      .insertInto("cf_cache")
      .values({
        key,
        payload,
        last_fetched: timestamp,
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          payload,
          last_fetched: timestamp,
        })
      )
      .execute();
  }
}
