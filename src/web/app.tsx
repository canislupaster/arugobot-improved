import { randomUUID } from "node:crypto";

import { serveStatic } from "@hono/node-server/serve-static";
import type { Client } from "discord.js";
import { Hono } from "hono";

import type { WebsiteService } from "../services/website.js";
import { logError, logInfo } from "../utils/logger.js";

import {
  renderGuildPage,
  renderHomePage,
  renderNotFoundPage,
  type GuildViewModel,
  type HomeViewModel,
} from "./views.js";

type WebAppContext = {
  website: WebsiteService;
  client: Client;
};

type WebVariables = {
  requestId: string;
};

function resolveGuildName(client: Client, guildId: string): string {
  const cached = client.guilds.cache.get(guildId);
  return cached?.name ?? "Unknown server";
}

function formatTournamentFormat(value: string): string {
  if (value === "swiss") {
    return "Swiss";
  }
  if (value === "elimination") {
    return "Elimination";
  }
  return value;
}

export function createWebApp({ website, client }: WebAppContext) {
  const app = new Hono<{ Variables: WebVariables }>();

  app.use("/static/*", serveStatic({ root: "./public" }));

  app.use("*", async (c, next) => {
    const requestId = randomUUID();
    const start = Date.now();
    c.set("requestId", requestId);
    try {
      await next();
    } finally {
      const latencyMs = Date.now() - start;
      c.header("x-request-id", requestId);
      logInfo("Web request handled.", {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        latencyMs,
      });
    }
  });

  app.get("/", async (c) => {
    const [global, guilds] = await Promise.all([
      website.getGlobalOverview(),
      website.listGuildSummaries(20),
    ]);
    const viewModel: HomeViewModel = {
      generatedAt: new Date().toISOString(),
      global,
      guilds: guilds.map((guild) => ({
        id: guild.guildId,
        name: resolveGuildName(client, guild.guildId),
        linkedUsers: guild.linkedUsers,
        activeChallenges: guild.activeChallenges,
        completedChallenges: guild.completedChallenges,
        lastChallengeAt: guild.lastChallengeAt,
      })),
    };
    return c.html(renderHomePage(viewModel));
  });

  app.get("/guilds/:guildId", async (c) => {
    const guildId = c.req.param("guildId");
    const activityDays = 30;
    const overview = await website.getGuildOverview(guildId, {
      activityDays,
      tournamentLimit: 4,
    });
    if (!overview || !overview.hasData) {
      return c.html(renderNotFoundPage("Guild not found or no data available."), 404);
    }
    const rosterMap = new Map(overview.roster.map((row) => [row.userId, row.handle]));
    const ratingLeaderboard = overview.ratingLeaderboard.slice(0, 10).map((row) => ({
      label: rosterMap.get(row.userId) ?? row.userId,
      value: row.rating,
    }));
    const solveLeaderboard = overview.solveLeaderboard.slice(0, 10).map((row) => ({
      label: rosterMap.get(row.userId) ?? row.userId,
      value: row.solvedCount,
    }));
    const topSolvers = overview.activity.topSolvers.map((row) => ({
      label: rosterMap.get(row.userId) ?? row.userId,
      value: row.solvedCount,
    }));

    const viewModel: GuildViewModel = {
      generatedAt: new Date().toISOString(),
      guild: {
        id: guildId,
        name: resolveGuildName(client, guildId),
        stats: overview.stats,
        ratingLeaderboard,
        solveLeaderboard,
        roster: overview.roster,
        activity: {
          windowLabel: `Last ${activityDays}d`,
          completedChallenges: overview.activity.completedChallenges,
          participantCount: overview.activity.participantCount,
          uniqueParticipants: overview.activity.uniqueParticipants,
          solvedCount: overview.activity.solvedCount,
          topSolvers,
        },
        contestActivity: overview.contestActivity,
        tournaments: overview.tournaments.map((tournament) => ({
          ...tournament,
          format: formatTournamentFormat(tournament.format),
        })),
      },
    };
    return c.html(renderGuildPage(viewModel));
  });

  app.notFound((c) => c.html(renderNotFoundPage("Page not found."), 404));

  app.onError((error, c) => {
    logError("Web request failed.", {
      requestId: c.get("requestId"),
      error: error instanceof Error ? error.message : String(error),
      path: c.req.path,
    });
    return c.html(renderNotFoundPage("Something went wrong."), 500);
  });

  return app;
}
