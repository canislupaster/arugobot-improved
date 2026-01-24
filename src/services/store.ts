import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError, logInfo } from "../utils/logger.js";

import { CodeforcesClient } from "./codeforces.js";

export type UserStatusResponse = Array<{
  id: number;
  verdict?: string;
  contestId?: number;
  problem: { contestId?: number; index: string };
}>;

export type UserInfoResponse = Array<{ handle: string }>;

type HistoryWithRatings = {
  history: string[];
  ratingHistory: number[];
};

function parseJsonArray<T>(raw: string | null | undefined, fallback: T[]): T[] {
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export class StoreService {
  constructor(private db: Kysely<Database>, private cfClient: CodeforcesClient) {}

  async getHandles(): Promise<string[]> {
    try {
      const rows = await this.db.selectFrom("users").select("handle").execute();
      return rows.map((row) => row.handle);
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return [];
    }
  }

  async updateHandle(oldHandle: string, newHandle: string): Promise<void> {
    try {
      await this.db
        .updateTable("users")
        .set({ handle: newHandle, updated_at: new Date().toISOString() })
        .where("handle", "=", oldHandle)
        .execute();
    } catch (error) {
      logError(`Database error: ${String(error)}`);
    }
  }

  async handleExists(serverId: string, handle: string): Promise<boolean> {
    try {
      const row = await this.db
        .selectFrom("users")
        .select("user_id")
        .where("server_id", "=", serverId)
        .where("handle", "=", handle)
        .executeTakeFirst();
      return Boolean(row);
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return false;
    }
  }

  async handleLinked(serverId: string, userId: string): Promise<boolean> {
    try {
      const row = await this.db
        .selectFrom("users")
        .select("handle")
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return Boolean(row);
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return false;
    }
  }

  async getHandle(serverId: string, userId: string): Promise<string | null> {
    try {
      const row = await this.db
        .selectFrom("users")
        .select("handle")
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row?.handle ?? null;
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return null;
    }
  }

  async getRating(serverId: string, userId: string): Promise<number> {
    try {
      const row = await this.db
        .selectFrom("users")
        .select("rating")
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row?.rating ?? -1;
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return -1;
    }
  }

  async getHistoryList(serverId: string, userId: string): Promise<string[]> {
    try {
      const row = await this.db
        .selectFrom("users")
        .select("history")
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return parseJsonArray<string>(row?.history, []);
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return [];
    }
  }

  async getHistoryWithRatings(
    serverId: string,
    userId: string
  ): Promise<HistoryWithRatings | null> {
    try {
      const row = await this.db
        .selectFrom("users")
        .select(["history", "rating_history"])
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (!row) {
        return null;
      }
      return {
        history: parseJsonArray<string>(row.history, []),
        ratingHistory: parseJsonArray<number>(row.rating_history, []),
      };
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return null;
    }
  }

  async addToHistory(serverId: string, userId: string, problem: string): Promise<void> {
    try {
      const row = await this.db
        .selectFrom("users")
        .select("history")
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (!row) {
        return;
      }
      const history = parseJsonArray<string>(row.history, []);
      history.push(problem);
      await this.db
        .updateTable("users")
        .set({
          history: JSON.stringify(history),
          updated_at: new Date().toISOString(),
        })
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .execute();
    } catch (error) {
      logError(`Database error: ${String(error)}`);
    }
  }

  async updateRating(serverId: string, userId: string, rating: number): Promise<void> {
    try {
      const row = await this.db
        .selectFrom("users")
        .select("rating_history")
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      const history = parseJsonArray<number>(row?.rating_history, []);
      history.push(rating);
      await this.db
        .updateTable("users")
        .set({
          rating,
          rating_history: JSON.stringify(history),
          updated_at: new Date().toISOString(),
        })
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .execute();
    } catch (error) {
      logError(`Database error (rating update): ${String(error)}`);
    }
  }

  async getLeaderboard(
    serverId: string
  ): Promise<Array<{ userId: string; rating: number }> | null> {
    try {
      const rows = await this.db
        .selectFrom("users")
        .select(["user_id", "rating"])
        .where("server_id", "=", serverId)
        .orderBy("rating", "desc")
        .execute();
      return rows.map((row) => ({ userId: row.user_id, rating: row.rating }));
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return null;
    }
  }

  async unlinkUser(serverId: string, userId: string): Promise<void> {
    try {
      await this.db
        .deleteFrom("users")
        .where("server_id", "=", serverId)
        .where("user_id", "=", userId)
        .execute();
    } catch (error) {
      logError(`Database error: ${String(error)}`);
    }
  }

  async insertUser(
    serverId: string,
    userId: string,
    handle: string
  ): Promise<"ok" | "handle_exists" | "already_linked" | "error"> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const existingHandle = await trx
          .selectFrom("users")
          .select("handle")
          .where("server_id", "=", serverId)
          .where("handle", "=", handle)
          .executeTakeFirst();
        if (existingHandle) {
          return "handle_exists";
        }

        const linkedHandle = await trx
          .selectFrom("users")
          .select("handle")
          .where("server_id", "=", serverId)
          .where("user_id", "=", userId)
          .executeTakeFirst();
        if (linkedHandle) {
          return "already_linked";
        }

        await trx
          .insertInto("users")
          .values({
            server_id: serverId,
            user_id: userId,
            handle,
            rating: 1500,
            history: "[]",
            rating_history: "[1500]",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .execute();

        return "ok";
      });
    } catch (error) {
      logError(`Transaction failed: ${String(error)}`);
      return "error";
    }
  }

  async getSolvedProblems(handle: string): Promise<string[] | null> {
    let result: string[] = [];
    let newLast = -1;

    try {
      const row = await this.db
        .selectFrom("ac")
        .select(["solved", "last_sub"])
        .where("handle", "=", handle)
        .executeTakeFirst();

      if (row) {
        logInfo("Small query.");
        const prevLast = row.last_sub;
        const currentList = parseJsonArray<string>(row.solved, []);
        try {
          const response = await this.cfClient.request<UserStatusResponse>("user.status", {
            handle,
            from: 1,
            count: 20,
          });

          let found = false;
          let first = true;
          for (const sub of response) {
            if (first) {
              newLast = sub.id;
              first = false;
            }
            if (sub.id !== prevLast) {
              if (sub.verdict === "OK" && sub.problem.contestId) {
                currentList.push(`${sub.problem.contestId}${sub.problem.index}`);
              }
            } else {
              found = true;
              logInfo("Small query worked.");
              result = currentList;
              break;
            }
          }

          if (!found) {
            const { solved, lastSubId } = await this.fetchLargeSolvedList(handle);
            result = solved;
            if (lastSubId !== null) {
              newLast = lastSubId;
            }
          }
        } catch (error) {
          logError(`Error when getting submissions: ${String(error)}`);
          return null;
        }
      } else {
        logInfo("Large query.");
        try {
          const { solved, lastSubId } = await this.fetchLargeSolvedList(handle);
          result = solved;
          if (lastSubId !== null) {
            newLast = lastSubId;
          }
        } catch (error) {
          logError(`Error when getting submissions: ${String(error)}`);
          return null;
        }
      }
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return null;
    }

    if (newLast !== -1) {
      result = Array.from(new Set(result));
      try {
        await this.db
          .insertInto("ac")
          .values({
            handle,
            solved: JSON.stringify(result),
            last_sub: newLast,
            updated_at: new Date().toISOString(),
          })
          .onConflict((oc) =>
            oc.column("handle").doUpdateSet({
              solved: JSON.stringify(result),
              last_sub: newLast,
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      } catch (error) {
        logError(`Database error: ${String(error)}`);
      }
    }

    return result;
  }

  private async fetchLargeSolvedList(
    handle: string
  ): Promise<{ solved: string[]; lastSubId: number | null }> {
    const result: string[] = [];
    let lastSubId: number | null = null;
    let index = 1;
    while (Math.floor(index / 5000) < 4) {
      const response = await this.cfClient.request<UserStatusResponse>("user.status", {
        handle,
        from: index,
        count: 5000,
      });
      logInfo(String(response.length));
      logInfo(String(index));

      if (response.length === 0) {
        break;
      }
      if (index === 1 && response[0]) {
        lastSubId = response[0].id;
      }

      for (const sub of response) {
        if (sub.verdict === "OK" && sub.problem.contestId) {
          result.push(`${sub.problem.contestId}${sub.problem.index}`);
        }
      }

      if (response.length < 5000) {
        break;
      }

      index += 5000;
    }
    return { solved: result, lastSubId };
  }

  async getNewHandle(handle: string): Promise<string> {
    try {
      const response = await this.cfClient.request<UserInfoResponse>("user.info", {
        handles: handle,
      });
      if (!response[0]) {
        return handle;
      }
      return response[0].handle;
    } catch (error) {
      logError(`Access error: ${String(error)}`);
      return handle;
    }
  }

  async handleExistsOnCf(handle: string): Promise<boolean> {
    if (!/^[-_a-zA-Z0-9]+$/.test(handle)) {
      return false;
    }
    try {
      const response = await this.cfClient.request<UserInfoResponse>("user.info", {
        handles: handle,
      });
      return response[0]?.handle.toLowerCase() === handle.toLowerCase();
    } catch (error) {
      logError(`Request error: ${String(error)}`);
      return false;
    }
  }
}
