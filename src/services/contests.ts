import { logError, logInfo } from "../utils/logger.js";

import type { CodeforcesClient } from "./codeforces.js";

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

  constructor(private client: CodeforcesClient) {}

  getLastRefreshAt(): number {
    return this.lastRefresh;
  }

  getLastError() {
    return this.lastError;
  }

  async refresh(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastRefresh < CACHE_TTL_MS) {
      return;
    }
    try {
      const result = await this.client.request<ContestListResponse>("contest.list", {
        gym: false,
      });
      this.contests = result;
      this.lastRefresh = now;
      logInfo("Loaded contests from Codeforces.", { contestCount: result.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError("Failed to load contests.", { error: message });
      throw error;
    }
  }

  getUpcoming(limit = 5): Contest[] {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return this.contests
      .filter((contest) => contest.phase === "BEFORE" && contest.startTimeSeconds > nowSeconds)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
      .slice(0, limit);
  }

  getOngoing(): Contest[] {
    return this.contests
      .filter((contest) => contest.phase === "CODING")
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  }
}
