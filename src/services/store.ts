import { sql, type Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";

import { CodeforcesClient } from "./codeforces.js";

export type UserStatusResponse = Array<{
  id: number;
  verdict?: string;
  contestId?: number;
  problem: { contestId?: number; index: string; name?: string };
  creationTimeSeconds: number;
  programmingLanguage?: string;
}>;

export type UserInfoResponse = Array<{
  handle: string;
  rating?: number;
  rank?: string;
  maxRating?: number;
  maxRank?: string;
  lastOnlineTimeSeconds?: number;
}>;

type HistoryWithRatings = {
  history: string[];
  ratingHistory: number[];
};

type ServerStats = {
  userCount: number;
  totalChallenges: number;
  avgRating: number | null;
  topRating: number | null;
};

const HANDLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PROFILE_CACHE_TTL_MS = 60 * 60 * 1000;
const RECENT_SUBMISSIONS_TTL_MS = 5 * 60 * 1000;
const RECENT_SUBMISSIONS_FETCH_COUNT = 20;
const SOLVED_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SOLVED_PAGES = 10;

export type CodeforcesProfile = {
  handle: string;
  displayHandle: string;
  rating: number | null;
  rank: string | null;
  maxRating: number | null;
  maxRank: string | null;
  lastOnlineTimeSeconds: number | null;
  lastFetched: string;
};

export type CodeforcesProfileResult = {
  profile: CodeforcesProfile;
  source: "cache" | "api";
  isStale: boolean;
};

export type RecentSubmission = {
  id: number;
  contestId: number | null;
  index: string;
  name: string;
  verdict: string | null;
  creationTimeSeconds: number;
  programmingLanguage: string | null;
};

export type RecentSubmissionsResult = {
  submissions: RecentSubmission[];
  source: "cache" | "api";
  isStale: boolean;
};

export type ChallengeHistoryEntry = {
  challengeId: string;
  problemId: string;
  contestId: number;
  index: string;
  name: string;
  rating: number;
  startedAt: number;
  endsAt: number;
  solvedAt: number | null;
  ratingDelta: number | null;
};

export type ChallengeHistoryPage = {
  total: number;
  entries: ChallengeHistoryEntry[];
};

type HandleResolution = {
  exists: boolean;
  canonicalHandle: string | null;
  source: "cache" | "api";
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

function isCacheFresh(lastFetched: string | null | undefined, ttlMs: number): boolean {
  if (!lastFetched || ttlMs <= 0) {
    return false;
  }
  const lastFetchedAt = Date.parse(lastFetched);
  if (!Number.isFinite(lastFetchedAt)) {
    return false;
  }
  const ageMs = Date.now() - lastFetchedAt;
  return ageMs >= 0 && ageMs <= ttlMs;
}

export class StoreService {
  private maxSolvedPages: number;

  constructor(
    private db: Kysely<Database>,
    private cfClient: CodeforcesClient,
    options: { maxSolvedPages?: number } = {}
  ) {
    this.maxSolvedPages = options.maxSolvedPages ?? DEFAULT_MAX_SOLVED_PAGES;
  }

  private normalizeHandle(handle: string): string {
    return handle.trim().toLowerCase();
  }

  private mapProfileRow(row: {
    handle: string;
    display_handle: string;
    rating: number | null;
    rank: string | null;
    max_rating: number | null;
    max_rank: string | null;
    last_online: number | null;
    last_fetched: string;
  }): CodeforcesProfile {
    return {
      handle: row.handle,
      displayHandle: row.display_handle,
      rating: row.rating ?? null,
      rank: row.rank ?? null,
      maxRating: row.max_rating ?? null,
      maxRank: row.max_rank ?? null,
      lastOnlineTimeSeconds: row.last_online ?? null,
      lastFetched: row.last_fetched,
    };
  }

  private isHandleValid(handle: string): boolean {
    return /^[-_a-zA-Z0-9]+$/.test(handle);
  }

  async checkDb(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db);
      return true;
    } catch (error) {
      logError(`Database connectivity failed: ${String(error)}`);
      return false;
    }
  }

  async getHandles(): Promise<string[]> {
    try {
      const rows = await this.db.selectFrom("users").select("handle").execute();
      return rows.map((row) => row.handle);
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return [];
    }
  }

  async getHandlesForServer(serverId: string): Promise<string[]> {
    try {
      const rows = await this.db
        .selectFrom("users")
        .select("handle")
        .where("server_id", "=", serverId)
        .execute();
      return rows.map((row) => row.handle);
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return [];
    }
  }

  async getLinkedUsers(serverId: string): Promise<Array<{ userId: string; handle: string }>> {
    try {
      const rows = await this.db
        .selectFrom("users")
        .select(["user_id", "handle"])
        .where("server_id", "=", serverId)
        .execute();
      return rows.map((row) => ({ userId: row.user_id, handle: row.handle }));
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

  async resolveHandle(handle: string, ttlMs = HANDLE_CACHE_TTL_MS): Promise<HandleResolution> {
    if (!this.isHandleValid(handle)) {
      return { exists: false, canonicalHandle: null, source: "cache" };
    }

    const key = this.normalizeHandle(handle);
    try {
      const cached = await this.db
        .selectFrom("cf_handles")
        .select(["canonical_handle", "exists", "last_checked"])
        .where("handle", "=", key)
        .executeTakeFirst();

      if (cached && isCacheFresh(cached.last_checked, ttlMs)) {
        return {
          exists: cached.exists === 1,
          canonicalHandle: cached.canonical_handle,
          source: "cache",
        };
      }
    } catch (error) {
      logError(`Database error: ${String(error)}`);
    }

    try {
      const response = await this.cfClient.request<UserInfoResponse>("user.info", {
        handles: handle,
      });
      const canonicalHandle = response[0]?.handle ?? null;
      const exists = Boolean(canonicalHandle);
      await this.db
        .insertInto("cf_handles")
        .values({
          handle: key,
          canonical_handle: canonicalHandle,
          exists: exists ? 1 : 0,
          last_checked: new Date().toISOString(),
        })
        .onConflict((oc) =>
          oc.column("handle").doUpdateSet({
            canonical_handle: canonicalHandle,
            exists: exists ? 1 : 0,
            last_checked: new Date().toISOString(),
          })
        )
        .execute();
      return { exists, canonicalHandle, source: "api" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNotFound = message.toLowerCase().includes("not found");
      if (isNotFound) {
        try {
          await this.db
            .insertInto("cf_handles")
            .values({
              handle: key,
              canonical_handle: null,
              exists: 0,
              last_checked: new Date().toISOString(),
            })
            .onConflict((oc) =>
              oc.column("handle").doUpdateSet({
                canonical_handle: null,
                exists: 0,
                last_checked: new Date().toISOString(),
              })
            )
            .execute();
        } catch (dbError) {
          logError(`Database error: ${String(dbError)}`);
        }
      }
      logError(`Request error: ${message}`);
      return { exists: false, canonicalHandle: null, source: "api" };
    }
  }

  async getCodeforcesProfile(
    handle: string,
    ttlMs = PROFILE_CACHE_TTL_MS
  ): Promise<CodeforcesProfileResult | null> {
    const key = this.normalizeHandle(handle);
    let cached:
      | {
          handle: string;
          display_handle: string;
          rating: number | null;
          rank: string | null;
          max_rating: number | null;
          max_rank: string | null;
          last_online: number | null;
          last_fetched: string;
        }
      | undefined;

    try {
      cached = await this.db
        .selectFrom("cf_profiles")
        .select([
          "handle",
          "display_handle",
          "rating",
          "rank",
          "max_rating",
          "max_rank",
          "last_online",
          "last_fetched",
        ])
        .where("handle", "=", key)
        .executeTakeFirst();
    } catch (error) {
      logError(`Database error: ${String(error)}`);
    }

    if (cached && isCacheFresh(cached.last_fetched, ttlMs)) {
      return { profile: this.mapProfileRow(cached), source: "cache", isStale: false };
    }

    try {
      const response = await this.cfClient.request<UserInfoResponse>("user.info", {
        handles: handle,
      });
      const profile = response[0];
      if (!profile) {
        return null;
      }
      const record = {
        handle: key,
        display_handle: profile.handle,
        rating: profile.rating ?? null,
        rank: profile.rank ?? null,
        max_rating: profile.maxRating ?? null,
        max_rank: profile.maxRank ?? null,
        last_online: profile.lastOnlineTimeSeconds ?? null,
        last_fetched: new Date().toISOString(),
      };
      await this.db
        .insertInto("cf_profiles")
        .values(record)
        .onConflict((oc) =>
          oc.column("handle").doUpdateSet({
            display_handle: record.display_handle,
            rating: record.rating,
            rank: record.rank,
            max_rating: record.max_rating,
            max_rank: record.max_rank,
            last_online: record.last_online,
            last_fetched: record.last_fetched,
          })
        )
        .execute();
      return { profile: this.mapProfileRow(record), source: "api", isStale: false };
    } catch (error) {
      logError(`Request error: ${String(error)}`);
      if (cached) {
        return { profile: this.mapProfileRow(cached), source: "cache", isStale: true };
      }
      return null;
    }
  }

  async getRecentSubmissions(
    handle: string,
    limit = 10,
    ttlMs = RECENT_SUBMISSIONS_TTL_MS
  ): Promise<RecentSubmissionsResult | null> {
    const key = this.normalizeHandle(handle);
    let cached: { submissions: string; last_fetched: string } | undefined;

    try {
      cached = await this.db
        .selectFrom("cf_recent_submissions")
        .select(["submissions", "last_fetched"])
        .where("handle", "=", key)
        .executeTakeFirst();
    } catch (error) {
      logError(`Database error: ${String(error)}`);
    }

    if (cached && isCacheFresh(cached.last_fetched, ttlMs)) {
      const submissions = parseJsonArray<RecentSubmission>(cached.submissions, []);
      return { submissions: submissions.slice(0, limit), source: "cache", isStale: false };
    }

    try {
      const response = await this.cfClient.request<UserStatusResponse>("user.status", {
        handle,
        from: 1,
        count: Math.max(limit, RECENT_SUBMISSIONS_FETCH_COUNT),
      });
      const submissions: RecentSubmission[] = response.map((submission) => ({
        id: submission.id,
        contestId: submission.problem.contestId ?? submission.contestId ?? null,
        index: submission.problem.index,
        name: submission.problem.name ?? "Unknown problem",
        verdict: submission.verdict ?? null,
        creationTimeSeconds: submission.creationTimeSeconds,
        programmingLanguage: submission.programmingLanguage ?? null,
      }));
      await this.db
        .insertInto("cf_recent_submissions")
        .values({
          handle: key,
          submissions: JSON.stringify(submissions),
          last_fetched: new Date().toISOString(),
        })
        .onConflict((oc) =>
          oc.column("handle").doUpdateSet({
            submissions: JSON.stringify(submissions),
            last_fetched: new Date().toISOString(),
          })
        )
        .execute();
      return { submissions: submissions.slice(0, limit), source: "api", isStale: false };
    } catch (error) {
      logError(`Request error: ${String(error)}`);
      if (cached) {
        const submissions = parseJsonArray<RecentSubmission>(cached.submissions, []);
        return { submissions: submissions.slice(0, limit), source: "cache", isStale: true };
      }
      return null;
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

  async getUserIdByHandle(serverId: string, handle: string): Promise<string | null> {
    try {
      const row = await this.db
        .selectFrom("users")
        .select("user_id")
        .where("server_id", "=", serverId)
        .where("handle", "=", handle)
        .executeTakeFirst();
      return row?.user_id ?? null;
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return null;
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

  async getChallengeHistoryPage(
    serverId: string,
    userId: string,
    page: number,
    pageSize: number
  ): Promise<ChallengeHistoryPage> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const limit = Math.max(1, pageSize);
    const offset = (safePage - 1) * limit;

    try {
      const countRow = await this.db
        .selectFrom("challenge_participants")
        .innerJoin("challenges", "challenges.id", "challenge_participants.challenge_id")
        .select(({ fn }) => fn.count<number>("challenge_participants.challenge_id").as("count"))
        .where("challenges.server_id", "=", serverId)
        .where("challenge_participants.user_id", "=", userId)
        .where("challenges.status", "=", "completed")
        .executeTakeFirst();
      const total = Number(countRow?.count ?? 0);
      if (total === 0) {
        return { total: 0, entries: [] };
      }

      const rows = await this.db
        .selectFrom("challenge_participants")
        .innerJoin("challenges", "challenges.id", "challenge_participants.challenge_id")
        .select((eb) => [
          eb.ref("challenges.id").as("challenge_id"),
          eb.ref("challenges.problem_contest_id").as("problem_contest_id"),
          eb.ref("challenges.problem_index").as("problem_index"),
          eb.ref("challenges.problem_name").as("problem_name"),
          eb.ref("challenges.problem_rating").as("problem_rating"),
          eb.ref("challenges.started_at").as("started_at"),
          eb.ref("challenges.ends_at").as("ends_at"),
          eb.ref("challenge_participants.solved_at").as("solved_at"),
          eb.ref("challenge_participants.rating_delta").as("rating_delta"),
        ])
        .where("challenges.server_id", "=", serverId)
        .where("challenge_participants.user_id", "=", userId)
        .where("challenges.status", "=", "completed")
        .orderBy("challenges.started_at", "desc")
        .limit(limit)
        .offset(offset)
        .execute();

      return {
        total,
        entries: rows.map((row) => ({
          challengeId: row.challenge_id,
          problemId: `${row.problem_contest_id}${row.problem_index}`,
          contestId: row.problem_contest_id,
          index: row.problem_index,
          name: row.problem_name,
          rating: row.problem_rating,
          startedAt: row.started_at,
          endsAt: row.ends_at,
          solvedAt: row.solved_at ?? null,
          ratingDelta: row.rating_delta ?? null,
        })),
      };
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return { total: 0, entries: [] };
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

  async getServerRoster(
    serverId: string
  ): Promise<Array<{ userId: string; handle: string; rating: number }>> {
    try {
      const rows = await this.db
        .selectFrom("users")
        .select(["user_id", "handle", "rating"])
        .where("server_id", "=", serverId)
        .orderBy("rating", "desc")
        .orderBy("handle", "asc")
        .execute();
      return rows.map((row) => ({
        userId: row.user_id,
        handle: row.handle,
        rating: row.rating,
      }));
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return [];
    }
  }

  async getServerStats(serverId: string): Promise<ServerStats> {
    try {
      const rows = await this.db
        .selectFrom("users")
        .select(["rating", "history"])
        .where("server_id", "=", serverId)
        .execute();

      if (rows.length === 0) {
        return { userCount: 0, totalChallenges: 0, avgRating: null, topRating: null };
      }

      const challengeCountRow = await this.db
        .selectFrom("challenge_participants")
        .innerJoin("challenges", "challenges.id", "challenge_participants.challenge_id")
        .select(({ fn }) => fn.count<number>("challenge_participants.challenge_id").as("count"))
        .where("challenges.server_id", "=", serverId)
        .where("challenges.status", "=", "completed")
        .executeTakeFirst();
      const completedCount = Number(challengeCountRow?.count ?? 0);

      let totalRating = 0;
      let topRating = Number.NEGATIVE_INFINITY;
      let totalChallenges = completedCount;

      for (const row of rows) {
        totalRating += row.rating;
        topRating = Math.max(topRating, row.rating);
        if (completedCount === 0) {
          const history = parseJsonArray<string>(row.history, []);
          totalChallenges += history.length;
        }
      }

      return {
        userCount: rows.length,
        totalChallenges,
        avgRating: Math.round(totalRating / rows.length),
        topRating: Number.isFinite(topRating) ? topRating : null,
      };
    } catch (error) {
      logError(`Database error: ${String(error)}`);
      return { userCount: 0, totalChallenges: 0, avgRating: null, topRating: null };
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

  async getSolvedProblems(handle: string, ttlMs = SOLVED_CACHE_TTL_MS): Promise<string[] | null> {
    const key = this.normalizeHandle(handle);
    let result: string[] = [];
    let newLast = -1;
    let row:
      | {
          handle: string;
          solved: string;
          last_sub: number;
          updated_at: string;
        }
      | undefined;

    try {
      const candidates = key === handle ? [key] : [key, handle];
      let rows = await this.db
        .selectFrom("ac")
        .select(["handle", "solved", "last_sub", "updated_at"])
        .where("handle", "in", candidates)
        .execute();

      if (rows.length === 0) {
        rows = await this.db
          .selectFrom("ac")
          .select(["handle", "solved", "last_sub", "updated_at"])
          .where((eb) => eb.fn("lower", [eb.ref("handle")]), "=", key)
          .execute();
      }

      row = rows.find((entry) => entry.handle === key) ?? rows[0];

      const legacy =
        row && row.handle !== key ? row : rows.find((entry) => entry.handle === handle);
      if (!rows.find((entry) => entry.handle === key) && legacy) {
        await this.db.transaction().execute(async (trx) => {
          await trx
            .insertInto("ac")
            .values({
              handle: key,
              solved: legacy.solved,
              last_sub: legacy.last_sub,
              updated_at: legacy.updated_at,
            })
            .onConflict((oc) =>
              oc.column("handle").doUpdateSet({
                solved: legacy.solved,
                last_sub: legacy.last_sub,
                updated_at: legacy.updated_at,
              })
            )
            .execute();
          await trx.deleteFrom("ac").where("handle", "=", legacy.handle).execute();
        });
        row = { ...legacy, handle: key };
      }

      if (row) {
        if (isCacheFresh(row.updated_at, ttlMs)) {
          return parseJsonArray<string>(row.solved, []);
        }
        logInfo("Solved list incremental refresh.", { handle: key });
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
              logInfo("Solved list incremental refresh hit cached marker.", { handle: key });
              result = currentList;
              break;
            }
          }

          if (!found) {
            logInfo("Solved list incremental refresh fell back to full sync.", { handle: key });
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
        logInfo("Solved list full refresh.", { handle: key });
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
            handle: key,
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

  async refreshHandles(): Promise<{ checked: number; updated: number }> {
    const handles = await this.getHandles();
    const uniqueHandles = Array.from(new Set(handles));
    let updated = 0;

    for (const existingHandle of uniqueHandles) {
      const resolution = await this.resolveHandle(existingHandle);
      if (!resolution.exists || !resolution.canonicalHandle) {
        continue;
      }
      if (resolution.canonicalHandle !== existingHandle) {
        await this.updateHandle(existingHandle, resolution.canonicalHandle);
        updated += 1;
      }
    }

    return { checked: uniqueHandles.length, updated };
  }

  private async fetchLargeSolvedList(
    handle: string
  ): Promise<{ solved: string[]; lastSubId: number | null }> {
    const result: string[] = [];
    let lastSubId: number | null = null;
    let index = 1;
    let page = 0;
    const maxPages = this.maxSolvedPages <= 0 ? Number.POSITIVE_INFINITY : this.maxSolvedPages;
    while (page < maxPages) {
      const response = await this.cfClient.request<UserStatusResponse>("user.status", {
        handle,
        from: index,
        count: 5000,
      });

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
      page += 1;
    }
    if (page >= maxPages) {
      logWarn("Solved list fetch reached max pages.", {
        handle,
        maxPages,
      });
    }
    return { solved: result, lastSubId };
  }
}
