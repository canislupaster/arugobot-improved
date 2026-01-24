import type { Client } from "discord.js";

import type { AppConfig } from "../config/env.js";
import type { ChallengeService } from "../services/challenges.js";
import type { CodeforcesClient } from "../services/codeforces.js";
import type { ContestReminderService } from "../services/contestReminders.js";
import type { ContestService } from "../services/contests.js";
import type { PracticeReminderService } from "../services/practiceReminders.js";
import type { PracticeSuggestionService } from "../services/practiceSuggestions.js";
import type { ProblemService } from "../services/problems.js";
import type { StoreService } from "../services/store.js";
import type { TournamentRecapService } from "../services/tournamentRecaps.js";
import type { TournamentService } from "../services/tournaments.js";

export type CommandContext = {
  client: Client;
  config: AppConfig;
  commandSummaries: Array<{ name: string; description: string }>;
  correlationId: string;
  services: {
    challenges: ChallengeService;
    contests: ContestService;
    contestReminders: ContestReminderService;
    practiceReminders: PracticeReminderService;
    practiceSuggestions: PracticeSuggestionService;
    codeforces: CodeforcesClient;
    problems: ProblemService;
    store: StoreService;
    tournamentRecaps: TournamentRecapService;
    tournaments: TournamentService;
  };
};
