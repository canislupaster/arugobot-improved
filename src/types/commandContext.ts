import type { Client } from "discord.js";

import type { AppConfig } from "../config/env.js";
import type { ChallengeService } from "../services/challenges.js";
import type { CodeforcesClient } from "../services/codeforces.js";
import type { ContestActivityService } from "../services/contestActivity.js";
import type { ContestRatingAlertService } from "../services/contestRatingAlerts.js";
import type { ContestRatingChangesService } from "../services/contestRatingChanges.js";
import type { ContestReminderService } from "../services/contestReminders.js";
import type { ContestService } from "../services/contests.js";
import type { ContestStandingsService } from "../services/contestStandings.js";
import type { GuildSettingsService } from "../services/guildSettings.js";
import type { MetricsService } from "../services/metrics.js";
import type { PracticeReminderService } from "../services/practiceReminders.js";
import type { PracticeSuggestionService } from "../services/practiceSuggestions.js";
import type { ProblemService } from "../services/problems.js";
import type { RatingChangesService } from "../services/ratingChanges.js";
import type { StoreService } from "../services/store.js";
import type { TournamentRecapService } from "../services/tournamentRecaps.js";
import type { TournamentService } from "../services/tournaments.js";
import type { WeeklyDigestService } from "../services/weeklyDigest.js";

export type CommandContext = {
  client: Client;
  config: AppConfig;
  commandSummaries: Array<{ name: string; description: string }>;
  correlationId: string;
  services: {
    challenges: ChallengeService;
    contests: ContestService;
    contestActivity: ContestActivityService;
    contestReminders: ContestReminderService;
    contestRatingChanges: ContestRatingChangesService;
    contestRatingAlerts: ContestRatingAlertService;
    contestStandings: ContestStandingsService;
    guildSettings: GuildSettingsService;
    metrics: MetricsService;
    practiceReminders: PracticeReminderService;
    practiceSuggestions: PracticeSuggestionService;
    codeforces: CodeforcesClient;
    problems: ProblemService;
    ratingChanges: RatingChangesService;
    store: StoreService;
    tournamentRecaps: TournamentRecapService;
    tournaments: TournamentService;
    weeklyDigest: WeeklyDigestService;
  };
};
