import { randomUUID } from "node:crypto";

import { Client, GatewayIntentBits } from "discord.js";
import { sql } from "kysely";

import { handleCommandInteraction } from "./commands/handler.js";
import { commandData, commandList, commandMap } from "./commands/index.js";
import { loadConfig, validateConfig } from "./config/env.js";
import { initDb, destroyDb } from "./db/database.js";
import { migrateToLatest } from "./db/migrator.js";
import { CodeforcesClient } from "./services/codeforces.js";
import { ContestService } from "./services/contests.js";
import { ProblemService } from "./services/problems.js";
import { StoreService } from "./services/store.js";
import { CooldownManager } from "./utils/cooldown.js";
import { logError, logInfo } from "./utils/logger.js";

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
  const contests = new ContestService(codeforces);
  const problems = new ProblemService(codeforces);
  const store = new StoreService(db, codeforces);

  const commandSummaries = commandList.map((command) => ({
    name: command.data.name,
    description: command.data.description,
  }));

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  const cooldowns = new CooldownManager(3, 1);
  let parseInterval: NodeJS.Timeout | null = null;
  let shuttingDown = false;

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
      logError(`Codeforces connectivity failed: ${String(error)}`);
      throw error;
    }
  }

  async function fixHandles() {
    const handles = await store.getHandles();
    for (const handle of handles) {
      const newHandle = await store.getNewHandle(handle);
      if (newHandle !== handle) {
        logInfo(`Change from ${handle} to ${newHandle}.`);
        await store.updateHandle(handle, newHandle);
      }
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
      await fixHandles();
      logInfo("Data parsing complete.");
    } catch (error) {
      logError(`Error during parsing: ${String(error)}`);
    } finally {
      isParsing = false;
    }
  }

  client.once("ready", async () => {
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
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    const correlationId = randomUUID();
    const context = {
      client,
      config,
      commandSummaries,
      correlationId,
      services: { contests, codeforces, problems, store },
    };
    await handleCommandInteraction(interaction, commandMap, context, cooldowns, correlationId);
  });

  const shutdown = async (signal: string) => {
    shuttingDown = true;
    logInfo(`Shutting down (${signal})...`);
    if (parseInterval) {
      clearInterval(parseInterval);
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

  await validateConnectivity();
  await client.login(config.discordToken);
}

main().catch((error) => {
  logError(`Failed to start: ${String(error)}`);
  process.exit(1);
});
