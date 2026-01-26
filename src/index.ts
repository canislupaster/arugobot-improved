import { randomUUID } from "node:crypto";

import type { ServerType } from "@hono/node-server";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { sql } from "kysely";

import { handleCommandInteraction } from "./commands/handler.js";
import { commandData, commandList, commandMap } from "./commands/index.js";
import { loadConfig, validateConfig } from "./config/env.js";
import { initDb, destroyDb } from "./db/database.js";
import { migrateToLatest } from "./db/migrator.js";
import { ChallengeService, challengeUpdateIntervalMs } from "./services/challenges.js";
import { CodeforcesClient } from "./services/codeforces.js";
import { CodeforcesCacheService } from "./services/codeforcesCache.js";
import { ContestActivityService } from "./services/contestActivity.js";
import {
  ContestRatingAlertService,
  contestRatingAlertIntervalMs,
} from "./services/contestRatingAlerts.js";
import { ContestRatingChangesService } from "./services/contestRatingChanges.js";
import { ContestReminderService, contestReminderIntervalMs } from "./services/contestReminders.js";
import { ContestService } from "./services/contests.js";
import { ContestStandingsService } from "./services/contestStandings.js";
import { DatabaseBackupService, databaseBackupIntervalMs } from "./services/databaseBackups.js";
import { GuildSettingsService } from "./services/guildSettings.js";
import { LogsService, logCleanupIntervalMs } from "./services/logs.js";
import { MetricsService } from "./services/metrics.js";
import {
  PracticeReminderService,
  practiceReminderIntervalMs,
} from "./services/practiceReminders.js";
import { PracticeSuggestionService } from "./services/practiceSuggestions.js";
import { ProblemService } from "./services/problems.js";
import { RatingChangesService } from "./services/ratingChanges.js";
import { createRequestPool } from "./services/requestPool.js";
import { StoreService } from "./services/store.js";
import { TournamentRecapService } from "./services/tournamentRecaps.js";
import { TournamentService, tournamentArenaIntervalMs } from "./services/tournaments.js";
import { TokenUsageService } from "./services/tokenUsage.js";
import { WebsiteService } from "./services/website.js";
import { WeeklyDigestService, weeklyDigestIntervalMs } from "./services/weeklyDigest.js";
import type { WebServerStatus } from "./types/webStatus.js";
import { CooldownManager } from "./utils/cooldown.js";
import { logError, logInfo, logWarn, setLogSink } from "./utils/logger.js";
import { startWebServer } from "./web/server.js";

type ContestListResponse = Array<{ id: number }>;

async function main() {
  const config = loadConfig();
  const configErrors = validateConfig(config);
  if (configErrors.length > 0) {
    for (const error of configErrors) {
      logError(error);
    }
    throw new Error("Configuration validation failed.");
  }
  const db = initDb(config.databaseUrl);
  await migrateToLatest(db);
  const logs = new LogsService(db, config.logRetentionDays);
  setLogSink(logs);
  logInfo("Configuration loaded.", { environment: config.environment });

  const requestPool = await createRequestPool({
    proxyFetchUrl: config.proxyFetchUrl,
    requestDelayMs: config.codeforcesRequestDelayMs,
  });
  const codeforces = new CodeforcesClient({
    baseUrl: config.codeforcesApiBaseUrl,
    requestDelayMs: config.codeforcesRequestDelayMs,
    timeoutMs: config.codeforcesTimeoutMs,
    statusTimeoutMs: config.codeforcesStatusTimeoutMs,
    scheduler: requestPool,
  });
  const cache = new CodeforcesCacheService(db);
  const guildSettings = new GuildSettingsService(db);
  const contests = new ContestService(codeforces, cache);
  const contestRatingChanges = new ContestRatingChangesService(db, codeforces);
  const contestStandings = new ContestStandingsService(db, codeforces);
  const databaseBackups = new DatabaseBackupService(
    config.databaseUrl,
    config.databaseBackupDir ?? null,
    config.databaseBackupRetentionDays
  );
  const tokenUsage = new TokenUsageService(config.codexLogPath ?? null);
  const metrics = new MetricsService(db);
  const contestReminders = new ContestReminderService(db, contests);
  const problems = new ProblemService(codeforces, cache);
  const ratingChanges = new RatingChangesService(db, codeforces);
  const store = new StoreService(db, codeforces, {
    maxSolvedPages: config.codeforcesSolvedMaxPages,
  });
  const contestRatingAlerts = new ContestRatingAlertService(
    db,
    contests,
    contestRatingChanges,
    store
  );
  const contestActivity = new ContestActivityService(db, store, ratingChanges);
  const challenges = new ChallengeService(db, store, codeforces);
  const tournaments = new TournamentService(db, problems, store, challenges);
  const tournamentRecaps = new TournamentRecapService(db, tournaments);
  challenges.setCompletionNotifier(tournaments);
  const practiceReminders = new PracticeReminderService(db, problems, store);
  const practiceSuggestions = new PracticeSuggestionService(problems, store);
  const weeklyDigest = new WeeklyDigestService(db, store, contestActivity);
  const website = new WebsiteService(db, store, guildSettings, contestActivity, {
    codeforces,
    contests,
    tournaments,
    tokenUsage,
  });

  const commandSummaries = commandList.map((command) => ({
    name: command.data.name,
    description: command.data.description,
  }));

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  const cooldowns = new CooldownManager(3, 1);
  const webStatus: WebServerStatus = {
    status: "starting",
    host: config.webHost,
    requestedPort: config.webPort,
    actualPort: null,
    lastError: null,
  };
  let parseInterval: NodeJS.Timeout | null = null;
  let challengeInterval: NodeJS.Timeout | null = null;
  let contestReminderInterval: NodeJS.Timeout | null = null;
  let practiceReminderInterval: NodeJS.Timeout | null = null;
  let contestRatingAlertInterval: NodeJS.Timeout | null = null;
  let tournamentArenaInterval: NodeJS.Timeout | null = null;
  let logCleanupInterval: NodeJS.Timeout | null = null;
  let weeklyDigestInterval: NodeJS.Timeout | null = null;
  let databaseBackupInterval: NodeJS.Timeout | null = null;
  let tokenUsageInterval: NodeJS.Timeout | null = null;
  let webServer: ServerType | null = null;
  let shuttingDown = false;
  let isChallengeTicking = false;
  let isBackingUp = false;

  async function validateConnectivity() {
    try {
      await sql`select 1`.execute(db);
      logInfo("Database connectivity ok.");
    } catch (error) {
      logError(`Database connectivity failed: ${String(error)}`);
      throw error;
    }

    try {
      const contests = await codeforces.request<ContestListResponse>("contest.list", {
        gym: false,
      });
      logInfo("Codeforces connectivity ok.", { contestCount: contests.length });
    } catch (error) {
      logWarn(`Codeforces connectivity failed; continuing with cached data.`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let isParsing = false;
  async function parseData() {
    if (shuttingDown) {
      return;
    }
    if (isParsing) {
      return;
    }
    isParsing = true;
    try {
      logInfo("Parsing data...");
      await problems.refreshProblems(true);
      logInfo("Fixing handles...");
      const refreshSummary = await store.refreshHandles();
      logInfo("Handle refresh complete.", refreshSummary);
      logInfo("Data parsing complete.");
    } catch (error) {
      logError(`Error during parsing: ${String(error)}`);
    } finally {
      isParsing = false;
    }
  }

  const runLogCleanup = async () => {
    if (shuttingDown) {
      return;
    }
    try {
      const deleted = await logs.cleanupOldEntries();
      if (deleted > 0) {
        logInfo("Log cleanup complete.", { deleted });
      }
    } catch (error) {
      logWarn("Log cleanup failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const runDatabaseBackup = async () => {
    if (shuttingDown || isBackingUp) {
      return;
    }
    isBackingUp = true;
    try {
      await databaseBackups.runBackup();
    } catch (error) {
      logWarn("Database backup failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      isBackingUp = false;
    }
  };

  client.once(Events.ClientReady, async () => {
    logInfo(`Logged in as ${client.user?.tag ?? "unknown"}`);

    if (client.application) {
      try {
        if (config.discordGuildId) {
          const guild = await client.guilds.fetch(config.discordGuildId).catch(() => null);
          if (guild) {
            await guild.commands.set(commandData);
            logInfo(`Registered guild commands for ${guild.id}.`);
          } else {
            await client.application.commands.set(commandData);
            logInfo("Registered global commands (guild id not found).");
          }
        } else {
          await client.application.commands.set(commandData);
          logInfo("Registered global commands.");
        }
      } catch (error) {
        logError(`Command registration failed: ${String(error)}`);
      }
    }

    await parseData();
    parseInterval = setInterval(parseData, 60 * 60 * 1000);

    const tickChallenges = async () => {
      if (shuttingDown || isChallengeTicking) {
        return;
      }
      isChallengeTicking = true;
      try {
        await challenges.runTick(client);
      } finally {
        isChallengeTicking = false;
      }
    };
    await tickChallenges();
    challengeInterval = setInterval(tickChallenges, challengeUpdateIntervalMs);

    const tickContestReminders = async () => {
      if (shuttingDown) {
        return;
      }
      await contestReminders.runTick(client);
    };
    await tickContestReminders();
    contestReminderInterval = setInterval(tickContestReminders, contestReminderIntervalMs);

    const tickPracticeReminders = async () => {
      if (shuttingDown) {
        return;
      }
      await practiceReminders.runTick(client);
    };
    await tickPracticeReminders();
    practiceReminderInterval = setInterval(tickPracticeReminders, practiceReminderIntervalMs);

    const tickWeeklyDigest = async () => {
      if (shuttingDown) {
        return;
      }
      await weeklyDigest.runTick(client);
    };
    await tickWeeklyDigest();
    weeklyDigestInterval = setInterval(tickWeeklyDigest, weeklyDigestIntervalMs);

    const tickContestRatingAlerts = async () => {
      if (shuttingDown) {
        return;
      }
      await contestRatingAlerts.runTick(client);
    };
    await tickContestRatingAlerts();
    contestRatingAlertInterval = setInterval(tickContestRatingAlerts, contestRatingAlertIntervalMs);

    const tickArena = async () => {
      if (shuttingDown) {
        return;
      }
      try {
        const completions = await tournaments.runArenaTick();
        for (const completion of completions) {
          const recapResult = await tournamentRecaps.postRecapForTournament(
            completion.guildId,
            completion.tournamentId,
            client,
            true
          );
          if (recapResult.status === "sent") {
            logInfo("Arena tournament recap posted.", {
              guildId: completion.guildId,
              tournamentId: completion.tournamentId,
              channelId: recapResult.channelId,
            });
          }
        }
      } catch (error) {
        logWarn("Arena tournament tick failed.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    await tickArena();
    tournamentArenaInterval = setInterval(tickArena, tournamentArenaIntervalMs);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    const correlationId = randomUUID();
    const context = {
      client,
      config,
      commandSummaries,
      correlationId,
      webStatus,
      services: {
        challenges,
        contests,
        contestReminders,
        contestRatingChanges,
        contestRatingAlerts,
        contestStandings,
        contestActivity,
        guildSettings,
        databaseBackups,
        logs,
        metrics,
        practiceReminders,
        practiceSuggestions,
        codeforces,
        problems,
        ratingChanges,
        store,
        tokenUsage,
        tournamentRecaps,
        tournaments,
        weeklyDigest,
      },
    };
    try {
      await handleCommandInteraction(interaction, commandMap, context, cooldowns, correlationId);
    } catch (error) {
      logError("Interaction handler failed.", {
        correlationId,
        command: interaction.commandName,
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logInfo(`Shutting down (${signal})...`);
    if (parseInterval) {
      clearInterval(parseInterval);
    }
    if (challengeInterval) {
      clearInterval(challengeInterval);
    }
    if (contestReminderInterval) {
      clearInterval(contestReminderInterval);
    }
    if (practiceReminderInterval) {
      clearInterval(practiceReminderInterval);
    }
    if (weeklyDigestInterval) {
      clearInterval(weeklyDigestInterval);
    }
    if (contestRatingAlertInterval) {
      clearInterval(contestRatingAlertInterval);
    }
    if (tournamentArenaInterval) {
      clearInterval(tournamentArenaInterval);
    }
    if (logCleanupInterval) {
      clearInterval(logCleanupInterval);
    }
    if (databaseBackupInterval) {
      clearInterval(databaseBackupInterval);
    }
    if (tokenUsageInterval) {
      clearInterval(tokenUsageInterval);
    }
    if (webServer) {
      await new Promise<void>((resolve) => {
        webServer?.close(() => resolve());
      });
      webServer = null;
    }
    await client.destroy();
    setLogSink(null);
    await destroyDb();
    logInfo("Shutdown complete.");
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logError(`Unhandled rejection: ${String(reason)}`);
  });
  process.on("uncaughtException", (error) => {
    logError(`Uncaught exception: ${String(error)}`);
  });

  webServer = await startWebServer(
    { host: config.webHost, port: config.webPort },
    { website, client },
    webStatus
  );
  if (!webServer) {
    if (webStatus.status === "starting") {
      webStatus.status = "failed";
      webStatus.lastError = {
        message: "Web server failed to start.",
        timestamp: new Date().toISOString(),
      };
    }
    logWarn("Web server failed to start; continuing without dashboard.");
  }

  if (config.logRetentionDays > 0) {
    await runLogCleanup();
    logCleanupInterval = setInterval(runLogCleanup, logCleanupIntervalMs);
  }
  if (config.databaseBackupDir) {
    await runDatabaseBackup();
    databaseBackupInterval = setInterval(runDatabaseBackup, databaseBackupIntervalMs);
  }
  if (config.codexLogPath) {
    await tokenUsage.refresh();
    tokenUsageInterval = setInterval(() => tokenUsage.refresh(), 60 * 1000);
  }

  await validateConnectivity();
  await client.login(config.discordToken);
}

main().catch((error) => {
  logError(`Failed to start: ${String(error)}`);
  process.exit(1);
});
