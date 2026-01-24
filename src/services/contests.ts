import { logError, logInfo } from "../utils/logger.js";

import type { CodeforcesClient } from "./codeforces.js";
import { type CodeforcesCache, NoopCodeforcesCache } from "./codeforcesCache.js";

export type Contest = {
  id: number;
  name: string;
  phase: "BEFORE" | "CODING" | "FINISHED" | "PENDING_SYSTEM_TEST" | "SYSTEM_TEST";
  startTimeSeconds: number;
  durationSeconds: number;
};

type ContestListResponse = Contest[];

const CACHE_TTL_MS = 5 * 60 * 1000;

export class ContestService {
  private contests: Contest[] = [];
  private lastRefresh = 0;
  private lastError: { message: string; timestamp: string } | null = null;

  constructor(
    private client: CodeforcesClient,
    private cache: CodeforcesCache = new NoopCodeforcesCache()
  ) {}

  getLastRefreshAt(): number {
    return this.lastRefresh;
  }

  getLastError() {
    return this.lastError;
  }

  async refresh(force = false): Promise<void> {
    if (this.contests.length === 0) {
      await this.loadFromCache();
    }
    const now = Date.now();
    if (!force && this.contests.length > 0 && now - this.lastRefresh < CACHE_TTL_MS) {
      return;
    }
    try {
      const result = await this.client.request<ContestListResponse>("contest.list", {
        gym: false,
      });
      this.contests = result;
      this.lastRefresh = now;
      this.lastError = null;
      await this.cache.set("contest_list", result);
      logInfo("Loaded contests from Codeforces.", { contestCount: result.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError("Failed to load contests.", { error: message });
      throw error;
    }
  }

  getUpcomingContests(): Contest[] {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return this.contests
      .filter((contest) => contest.phase === "BEFORE" && contest.startTimeSeconds > nowSeconds)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
      .slice();
  }

  getUpcoming(limit = 5): Contest[] {
    return this.getUpcomingContests().slice(0, limit);
  }

  getOngoing(): Contest[] {
    return this.contests
      .filter((contest) => contest.phase === "CODING")
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  }

  getContestById(contestId: number): Contest | null {
    const match = this.contests.find((contest) => contest.id === contestId);
    return match ?? null;
  }

  getLatestFinished(): Contest | null {
    let latest: Contest | null = null;
    for (const contest of this.contests) {
      if (contest.phase !== "FINISHED") {
        continue;
      }
      if (!latest || contest.startTimeSeconds > latest.startTimeSeconds) {
        latest = contest;
      }
    }
    return latest;
  }

  searchContests(query: string, limit = 5): Contest[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    return this.contests
      .filter((contest) => contest.name.toLowerCase().includes(normalized))
      .sort((a, b) => b.startTimeSeconds - a.startTimeSeconds)
      .slice(0, limit);
  }

  private async loadFromCache(): Promise<boolean> {
    const cached = await this.cache.get<Contest[]>("contest_list");
    if (!cached || !Array.isArray(cached.value) || cached.value.length === 0) {
      return false;
    }
    this.contests = cached.value;
    const timestamp = Date.parse(cached.lastFetched);
    this.lastRefresh = Number.isFinite(timestamp) ? timestamp : 0;
    logInfo("Loaded contests from cache.", { contestCount: cached.value.length });
    return true;
  }
}
