import { logError, logInfo } from "../utils/logger.js";

import { CodeforcesClient } from "./codeforces.js";

export type Problem = {
  contestId: number;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
};

type ProblemsetResponse = {
  problems: Problem[];
};

export class ProblemService {
  private problems: Problem[] = [];
  private problemDict = new Map<string, Problem>();
  private lastRefresh = 0;
  private lastError: { message: string; timestamp: string } | null = null;

  constructor(private client: CodeforcesClient) {}

  getProblems(): Problem[] {
    return this.problems;
  }

  getProblemDict(): Map<string, Problem> {
    return this.problemDict;
  }

  getLastRefreshAt(): number {
    return this.lastRefresh;
  }

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async ensureProblemsLoaded(): Promise<Problem[]> {
    if (this.problems.length === 0) {
      await this.refreshProblems(true);
    }
    return this.problems;
  }

  async refreshProblems(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastRefresh < 60 * 60 * 1000) {
      return;
    }
    try {
      const result = await this.client.request<ProblemsetResponse>("problemset.problems");
      const filtered = result.problems.filter(
        (problem) => problem.rating !== undefined && !problem.tags.includes("*special")
      );
      this.problems = filtered;
      this.problemDict = new Map(
        filtered.map((problem) => [`${problem.contestId}${problem.index}`, problem])
      );
      this.lastRefresh = now;
      this.lastError = null;
      logInfo(`Loaded ${filtered.length} problems from Codeforces.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError("Failed to load problems from Codeforces.", { error: message });
      throw error;
    }
  }
}
