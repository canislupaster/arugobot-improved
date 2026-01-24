import { logInfo } from "../utils/logger.js";

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

  async refreshProblems(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastRefresh < 60 * 60 * 1000) {
      return;
    }
    const result = await this.client.request<ProblemsetResponse>("problemset.problems");
    const filtered = result.problems.filter(
      (problem) => problem.rating !== undefined && !problem.tags.includes("*special")
    );
    this.problems = filtered;
    this.problemDict = new Map(
      filtered.map((problem) => [`${problem.contestId}${problem.index}`, problem])
    );
    this.lastRefresh = now;
    logInfo(`Loaded ${filtered.length} problems from Codeforces.`);
  }
}
