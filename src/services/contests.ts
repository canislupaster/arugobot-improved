import { logError, logInfo } from "../utils/logger.js";

import type { CodeforcesClient } from "./codeforces.js";
import type { CacheKey } from "./codeforcesCache.js";
import { type CodeforcesCache, NoopCodeforcesCache } from "./codeforcesCache.js";

export type ContestScope = "official" | "gym";

export type ContestScopeFilter = ContestScope | "all";

export type Contest = {
  id: number;
  name: string;
  phase: "BEFORE" | "CODING" | "FINISHED" | "PENDING_SYSTEM_TEST" | "SYSTEM_TEST";
  startTimeSeconds: number;
  durationSeconds: number;
  isGym?: boolean;
};

type ContestListResponse = Contest[];

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SCOPE: ContestScope = "official";
const CACHE_KEY_BY_SCOPE: Record<ContestScope, CacheKey> = {
  official: "contest_list",
  gym: "contest_list_gym",
};

type ContestStore = {
  contests: Contest[];
  lastRefresh: number;
  lastError: { message: string; timestamp: string } | null;
};

export class ContestService {
  private store: Record<ContestScope, ContestStore> = {
    official: { contests: [], lastRefresh: 0, lastError: null },
    gym: { contests: [], lastRefresh: 0, lastError: null },
  };

  constructor(
    private client: CodeforcesClient,
    private cache: CodeforcesCache = new NoopCodeforcesCache()
  ) {}

  private normalizeContests(contests: Contest[], scope: ContestScope): Contest[] {
    return contests.map((contest) => ({
      ...contest,
      isGym: contest.isGym ?? scope === "gym",
    }));
  }

  getLastRefreshAt(scope: ContestScopeFilter = DEFAULT_SCOPE): number {
    if (scope === "all") {
      return Math.max(this.store.official.lastRefresh, this.store.gym.lastRefresh);
    }
    return this.store[scope].lastRefresh;
  }

  getLastError(scope: ContestScopeFilter = DEFAULT_SCOPE) {
    if (scope === "all") {
      return this.store.official.lastError ?? this.store.gym.lastError;
    }
    return this.store[scope].lastError;
  }

  async refresh(force = false, scope: ContestScope = DEFAULT_SCOPE): Promise<void> {
    const store = this.store[scope];
    if (store.contests.length === 0) {
      await this.loadFromCache(scope);
    }
    const now = Date.now();
    if (!force && store.contests.length > 0 && now - store.lastRefresh < CACHE_TTL_MS) {
      return;
    }
    try {
      const result = await this.client.request<ContestListResponse>("contest.list", {
        gym: scope === "gym",
      });
      const normalized = this.normalizeContests(result, scope);
      store.contests = normalized;
      store.lastRefresh = now;
      store.lastError = null;
      await this.cache.set(CACHE_KEY_BY_SCOPE[scope], normalized);
      logInfo("Loaded contests from Codeforces.", { contestCount: result.length, scope });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.lastError = { message, timestamp: new Date().toISOString() };
      logError("Failed to load contests.", { error: message, scope });
      throw error;
    }
  }

  getUpcomingContests(scope: ContestScopeFilter = DEFAULT_SCOPE): Contest[] {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return this.getContestsByScope(scope)
      .filter((contest) => contest.phase === "BEFORE" && contest.startTimeSeconds > nowSeconds)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
      .slice();
  }

  getUpcoming(limit = 5, scope: ContestScopeFilter = DEFAULT_SCOPE): Contest[] {
    return this.getUpcomingContests(scope).slice(0, limit);
  }

  getOngoing(scope: ContestScopeFilter = DEFAULT_SCOPE): Contest[] {
    return this.getContestsByScope(scope)
      .filter((contest) => contest.phase === "CODING")
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  }

  getContestById(contestId: number, scope: ContestScopeFilter = DEFAULT_SCOPE): Contest | null {
    const match = this.getContestsByScope(scope).find((contest) => contest.id === contestId);
    return match ?? null;
  }

  getLatestFinished(scope: ContestScopeFilter = DEFAULT_SCOPE): Contest | null {
    let latest: Contest | null = null;
    for (const contest of this.getContestsByScope(scope)) {
      if (contest.phase !== "FINISHED") {
        continue;
      }
      if (!latest || contest.startTimeSeconds > latest.startTimeSeconds) {
        latest = contest;
      }
    }
    return latest;
  }

  getFinished(
    limit = 10,
    sinceSeconds?: number,
    scope: ContestScopeFilter = DEFAULT_SCOPE
  ): Contest[] {
    const filtered = this.getContestsByScope(scope).filter(
      (contest) => contest.phase === "FINISHED"
    );
    const since = Number.isFinite(sinceSeconds) ? (sinceSeconds as number) : null;
    const matches = since
      ? filtered.filter((contest) => contest.startTimeSeconds >= since)
      : filtered;
    return matches.sort((a, b) => b.startTimeSeconds - a.startTimeSeconds).slice(0, limit);
  }

  searchContests(query: string, limit = 5, scope: ContestScopeFilter = DEFAULT_SCOPE): Contest[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    return this.getContestsByScope(scope)
      .filter((contest) => contest.name.toLowerCase().includes(normalized))
      .sort((a, b) => b.startTimeSeconds - a.startTimeSeconds)
      .slice(0, limit);
  }

  private getContestsByScope(scope: ContestScopeFilter): Contest[] {
    if (scope === "all") {
      const combined = new Map<number, Contest>();
      for (const contest of this.store.official.contests) {
        combined.set(contest.id, contest);
      }
      for (const contest of this.store.gym.contests) {
        if (!combined.has(contest.id)) {
          combined.set(contest.id, contest);
        }
      }
      return Array.from(combined.values());
    }
    return this.store[scope].contests;
  }

  private async loadFromCache(scope: ContestScope): Promise<boolean> {
    const cached = await this.cache.get<Contest[]>(CACHE_KEY_BY_SCOPE[scope]);
    if (!cached || !Array.isArray(cached.value) || cached.value.length === 0) {
      return false;
    }
    this.store[scope].contests = this.normalizeContests(cached.value, scope);
    const timestamp = Date.parse(cached.lastFetched);
    this.store[scope].lastRefresh = Number.isFinite(timestamp) ? timestamp : 0;
    logInfo("Loaded contests from cache.", { contestCount: cached.value.length, scope });
    return true;
  }
}
