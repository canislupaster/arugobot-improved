import type { Client } from "discord.js";

import type { AppConfig } from "../config/env.js";
import type { CodeforcesClient } from "../services/codeforces.js";
import type { ContestService } from "../services/contests.js";
import type { ProblemService } from "../services/problems.js";
import type { StoreService } from "../services/store.js";

export type CommandContext = {
  client: Client;
  config: AppConfig;
  commandSummaries: Array<{ name: string; description: string }>;
  services: {
    contests: ContestService;
    codeforces: CodeforcesClient;
    problems: ProblemService;
    store: StoreService;
  };
};
