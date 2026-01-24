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
import { ContestRatingChangesService } from "./services/contestRatingChanges.js";
import { ContestReminderService, contestReminderIntervalMs } from "./services/contestReminders.js";
import { ContestService } from "./services/contests.js";
import { ContestStandingsService } from "./services/contestStandings.js";
import { GuildSettingsService } from "./services/guildSettings.js";
import { MetricsService } from "./services/metrics.js";
import {
  PracticeReminderService,
  practiceReminderIntervalMs,
} from "./services/practiceReminders.js";
import { PracticeSuggestionService } from "./services/practiceSuggestions.js";
import { ProblemService } from "./services/problems.js";
import { RatingChangesService } from "./services/ratingChanges.js";
import { StoreService } from "./services/store.js";
import { TournamentRecapService } from "./services/tournamentRecaps.js";
import { TournamentService } from "./services/tournaments.js";
import { WebsiteService } from "./services/website.js";
import { CooldownManager } from "./utils/cooldown.js";
import { logError, logInfo, logWarn } from "./utils/logger.js";
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
  logInfo("Configuration loaded.", { environment: config.environment });
  const db = initDb(config.databaseUrl);
  await migrateToLatest(db);

  const codeforces = new CodeforcesClient({
    baseUrl: config.codeforcesApiBaseUrl,
    requestDelayMs: config.codeforcesRequestDelayMs,
    timeoutMs: config.codeforcesTimeoutMs,
  });
  const cache = new CodeforcesCacheService(db);
  const guildSettings = new GuildSettingsService(db);
  const contests = new ContestService(codeforces, cache);
  const contestRatingChanges = new ContestRatingChangesService(db, codeforces);
  const contestStandings = new ContestStandingsService(db, codeforces);
  const metrics = new MetricsService(db);
  const contestReminders = new ContestReminderService(db, contests);
  const problems = new ProblemService(codeforces, cache);
  const ratingChanges = new RatingChangesService(db, codeforces);
  const store = new StoreService(db, codeforces, {
    maxSolvedPages: config.codeforcesSolvedMaxPages,
  });
  const contestActivity = new ContestActivityService(db, store);
  const challenges = new ChallengeService(db, store, codeforces);
  const tournaments = new TournamentService(db, problems, store, challenges);
  const tournamentRecaps = new TournamentRecapService(db, tournaments);
  challenges.setCompletionNotifier(tournaments);
  const practiceReminders = new PracticeReminderService(db, problems, store);
  const practiceSuggestions = new PracticeSuggestionService(problems, store);
  const website = new WebsiteService(db, store, guildSettings, contestActivity);

  const commandSummaries = commandList.map((command) => ({
    name: command.data.name,
    description: command.data.description,
  }));

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  const cooldowns = new CooldownManager(3, 1);
  let parseInterval: NodeJS.Timeout | null = null;
  let challengeInterval: NodeJS.Timeout | null = null;
  let contestReminderInterval: NodeJS.Timeout | null = null;
  let practiceReminderInterval: NodeJS.Timeout | null = null;
  let webServer: ServerType | null = null;
  let shuttingDown = false;
  let isChallengeTicking = false;

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
      services: {
        challenges,
        contests,
        contestReminders,
        contestRatingChanges,
        contestStandings,
        contestActivity,
        guildSettings,
        metrics,
        practiceReminders,
        practiceSuggestions,
        codeforces,
        problems,
        ratingChanges,
        store,
        tournamentRecaps,
        tournaments,
      },
    };
    await handleCommandInteraction(interaction, commandMap, context, cooldowns, correlationId);
  });

  const shutdown = async (signal: string) => {
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
    if (webServer) {
      await new Promise<void>((resolve) => {
        webServer?.close(() => resolve());
      });
      webServer = null;
    }
    await client.destroy();
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

  webServer = startWebServer({ host: config.webHost, port: config.webPort }, { website, client });

  await validateConnectivity();
  await client.login(config.discordToken);
}

main().catch((error) => {
  logError(`Failed to start: ${String(error)}`);
  process.exit(1);
});
