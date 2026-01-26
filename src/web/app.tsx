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
  renderStatusPage,
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

type LeaderboardRow = {
  handle: string;
  userId: string;
  value: number;
};

type LabeledValue = {
  label: string;
  value: number;
};

function resolveGuildName(client: Client, guildId: string): string {
  const cached = client.guilds.cache.get(guildId);
  return cached?.name ?? "Unknown server";
}

function resolveRosterLabel(rosterMap: Map<string, string>, userId: string): string {
  return rosterMap.get(userId) ?? userId;
}

function mapRosterLeaderboard<T extends { userId: string }>(
  rows: T[],
  rosterMap: Map<string, string>,
  getValue: (row: T) => number,
  limit: number
): LabeledValue[] {
  return rows.slice(0, limit).map((row) => ({
    label: resolveRosterLabel(rosterMap, row.userId),
    value: getValue(row),
  }));
}

function escapeCsv(value: string | number): string {
  const raw = String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function escapeMarkdown(value: string | number): string {
  return String(value).replaceAll("|", "\\|");
}

function formatLeaderboardCsv(rows: LeaderboardRow[], valueLabel: string): string {
  const header = ["Rank", "Handle", "User ID", valueLabel].join(",");
  const body = rows.map((row, index) =>
    [escapeCsv(index + 1), escapeCsv(row.handle), escapeCsv(row.userId), escapeCsv(row.value)].join(
      ","
    )
  );
  return [header, ...body].join("\n");
}

function formatLeaderboardMarkdown(rows: LeaderboardRow[], valueLabel: string): string {
  const header = `| Rank | Handle | User ID | ${valueLabel} |`;
  const divider = "| --- | --- | --- | --- |";
  const body = rows.map(
    (row, index) =>
      `| ${index + 1} | ${escapeMarkdown(row.handle)} | ${escapeMarkdown(
        row.userId
      )} | ${row.value} |`
  );
  return [header, divider, ...body].join("\n");
}

export function createWebApp({ website, client }: WebAppContext) {
  const app = new Hono<{ Variables: WebVariables }>();

  app.use(
    "/static/*",
    serveStatic({
      root: "./public",
      rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
    })
  );

  app.get("/favicon.ico", (c) => c.redirect("/static/brand-icon.png", 302));

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
    const [global, guilds, upcomingContests] = await Promise.all([
      website.getGlobalOverview(),
      website.listGuildSummaries(20),
      website.getUpcomingContests(5),
    ]);
    const viewModel: HomeViewModel = {
      generatedAt: new Date().toISOString(),
      global,
      upcomingContests,
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

  app.get("/api/overview", async (c) => {
    const [global, guilds, upcomingContests] = await Promise.all([
      website.getGlobalOverview(),
      website.listGuildSummaries(20),
      website.getUpcomingContests(5),
    ]);
    return c.json({
      generatedAt: new Date().toISOString(),
      global,
      upcomingContests,
      guilds: guilds.map((guild) => ({
        id: guild.guildId,
        name: resolveGuildName(client, guild.guildId),
        linkedUsers: guild.linkedUsers,
        activeChallenges: guild.activeChallenges,
        completedChallenges: guild.completedChallenges,
        lastChallengeAt: guild.lastChallengeAt,
      })),
    });
  });

  app.get("/guilds/:guildId", async (c) => {
    const guildId = c.req.param("guildId");
    const activityDays = 30;
    const overview = await website.getGuildOverview(guildId);
    if (!overview || !overview.hasData) {
      return c.html(renderNotFoundPage("Guild not found or no data available."), 404);
    }
    const rosterMap = new Map(overview.roster.map((row) => [row.userId, row.handle]));
    const ratingLeaderboard = mapRosterLeaderboard(
      overview.ratingLeaderboard,
      rosterMap,
      (row) => row.rating,
      10
    );
    const solveLeaderboard = mapRosterLeaderboard(
      overview.solveLeaderboard,
      rosterMap,
      (row) => row.solvedCount,
      10
    );
    const currentStreakLeaderboard = mapRosterLeaderboard(
      overview.currentStreakLeaderboard,
      rosterMap,
      (row) => row.currentStreak,
      10
    );
    const longestStreakLeaderboard = mapRosterLeaderboard(
      overview.longestStreakLeaderboard,
      rosterMap,
      (row) => row.longestStreak,
      10
    );
    const topSolvers = mapRosterLeaderboard(
      overview.activity.topSolvers,
      rosterMap,
      (row) => row.solvedCount,
      overview.activity.topSolvers.length
    );

    const viewModel: GuildViewModel = {
      generatedAt: new Date().toISOString(),
      guild: {
        id: guildId,
        name: resolveGuildName(client, guildId),
        stats: overview.stats,
        ratingLeaderboard,
        solveLeaderboard,
        currentStreakLeaderboard,
        longestStreakLeaderboard,
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
        tournaments: overview.tournaments,
      },
    };
    return c.html(renderGuildPage(viewModel));
  });

  app.get("/api/guilds/:guildId", async (c) => {
    const guildId = c.req.param("guildId");
    const activityDays = 30;
    const overview = await website.getGuildOverview(guildId);
    if (!overview || !overview.hasData) {
      return c.json({ error: "Guild not found or no data available." }, 404);
    }
    return c.json({
      generatedAt: new Date().toISOString(),
      guild: {
        id: guildId,
        name: resolveGuildName(client, guildId),
        stats: overview.stats,
        ratingLeaderboard: overview.ratingLeaderboard,
        solveLeaderboard: overview.solveLeaderboard,
        currentStreakLeaderboard: overview.currentStreakLeaderboard,
        longestStreakLeaderboard: overview.longestStreakLeaderboard,
        roster: overview.roster,
        activity: {
          windowLabel: `Last ${activityDays}d`,
          completedChallenges: overview.activity.completedChallenges,
          participantCount: overview.activity.participantCount,
          uniqueParticipants: overview.activity.uniqueParticipants,
          solvedCount: overview.activity.solvedCount,
          topSolvers: overview.activity.topSolvers,
        },
        contestActivity: overview.contestActivity,
        tournaments: overview.tournaments,
      },
    });
  });

  app.get("/guilds/:guildId/exports/:metric/:format", async (c) => {
    const guildId = c.req.param("guildId");
    const metric = c.req.param("metric").toLowerCase();
    const format = c.req.param("format").toLowerCase();
    if (metric !== "rating" && metric !== "solves") {
      return c.text("Unknown export metric.", 404);
    }
    if (format !== "csv" && format !== "md") {
      return c.text("Unknown export format.", 404);
    }

    const leaderboards = await website.getGuildLeaderboards(guildId);
    if (!leaderboards) {
      return c.text("Guild not found or no data available.", 404);
    }

    const rows =
      metric === "rating"
        ? leaderboards.rating.map((entry) => ({
            handle: entry.handle,
            userId: entry.userId,
            value: entry.rating,
          }))
        : leaderboards.solves.map((entry) => ({
            handle: entry.handle,
            userId: entry.userId,
            value: entry.solvedCount,
          }));
    const valueLabel = metric === "rating" ? "Rating" : "Solves";
    const filename = `guild-${guildId}-${metric}.${format}`;

    if (format === "csv") {
      c.header("content-type", "text/csv; charset=utf-8");
      c.header("content-disposition", `attachment; filename="${filename}"`);
      return c.text(formatLeaderboardCsv(rows, valueLabel));
    }
    c.header("content-type", "text/markdown; charset=utf-8");
    c.header("content-disposition", `attachment; filename="${filename}"`);
    return c.text(formatLeaderboardMarkdown(rows, valueLabel));
  });

  app.get("/status", async (c) => {
    const cacheEntries = await website.getCacheStatus();
    return c.html(renderStatusPage({ generatedAt: new Date().toISOString(), cacheEntries }));
  });

  app.get("/status.json", async (c) => {
    const cacheEntries = await website.getCacheStatus();
    return c.json({ generatedAt: new Date().toISOString(), cacheEntries });
  });

  app.get("/healthz", async (c) => {
    const health = await website.getHealthStatus();
    return c.json(health);
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
