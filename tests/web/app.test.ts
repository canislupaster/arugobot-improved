import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import type { CodeforcesClient } from "../../src/services/codeforces.js";
import { ContestActivityService } from "../../src/services/contestActivity.js";
import { GuildSettingsService } from "../../src/services/guildSettings.js";
import type { RatingChangesService } from "../../src/services/ratingChanges.js";
import { StoreService } from "../../src/services/store.js";
import { WebsiteService } from "../../src/services/website.js";
import { createWebApp } from "../../src/web/app.js";

const mockCodeforces = {
  request: jest.fn(),
  getLastError: jest.fn().mockReturnValue(null),
  getLastSuccessAt: jest.fn().mockReturnValue("2024-01-01T00:00:00.000Z"),
} as unknown as CodeforcesClient;

const mockRatingChanges = {
  getRatingChanges: jest.fn().mockResolvedValue(null),
} as unknown as RatingChangesService;

const mockContestService = {
  refresh: jest.fn().mockResolvedValue(undefined),
  getUpcoming: jest
    .fn()
    .mockImplementation((_limit: number, scope: "official" | "gym") =>
      scope === "official"
        ? [
            {
              id: 1000,
              name: "Official Contest",
              phase: "BEFORE",
              startTimeSeconds: 1_700_000_000,
              durationSeconds: 7200,
              isGym: false,
            },
          ]
        : [
            {
              id: 2000,
              name: "Gym Contest",
              phase: "BEFORE",
              startTimeSeconds: 1_700_000_500,
              durationSeconds: 5400,
              isGym: true,
            },
          ]
    ),
  getLastRefreshAt: jest.fn().mockReturnValue(Date.parse("2024-02-01T00:00:00.000Z")),
};

describe("web app", () => {
  let db: Kysely<Database>;
  let website: WebsiteService;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const settings = new GuildSettingsService(db);
    const contestActivity = new ContestActivityService(db, store, mockRatingChanges);
    website = new WebsiteService(db, store, settings, contestActivity, {
      codeforces: mockCodeforces,
      contests: mockContestService as never,
    });

    await db
      .insertInto("users")
      .values({
        server_id: "guild-1",
        user_id: "user-1",
        handle: "alice",
        rating: 1500,
        history: "[]",
        rating_history: "[]",
      })
      .execute();

    await db
      .insertInto("guild_settings")
      .values({ guild_id: "guild-1", dashboard_public: 1 })
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("renders the home page", async () => {
    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map([["guild-1", { name: "Guild One" }]]) },
      } as never,
    });
    const response = await app.request("http://localhost/");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Global snapshot");
    expect(body).toContain("Guild One");
    expect(body).toContain("Upcoming official contests");
    expect(body).toContain("Official Contest");
    expect(body).toContain("og:image");
    expect(body).toContain("/static/local-time.js");
  });

  it("renders a guild page", async () => {
    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map([["guild-1", { name: "Guild One" }]]) },
      } as never,
    });
    const response = await app.request("http://localhost/guilds/guild-1");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Guild One");
  });

  it("returns 404 for private guilds", async () => {
    await db
      .updateTable("guild_settings")
      .set({ dashboard_public: 0 })
      .where("guild_id", "=", "guild-1")
      .execute();
    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map([["guild-1", { name: "Guild One" }]]) },
      } as never,
    });
    const response = await app.request("http://localhost/guilds/guild-1");
    expect(response.status).toBe(404);
  });

  it("renders arena tournament details", async () => {
    await db
      .insertInto("tournaments")
      .values({
        id: "arena-1",
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "user-1",
        format: "arena",
        status: "active",
        length_minutes: 75,
        round_count: 4,
        current_round: 1,
        rating_ranges: "800-1200",
        tags: "",
        updated_at: "2024-01-06T12:00:00.000Z",
      })
      .execute();

    await db
      .insertInto("tournament_participants")
      .values([
        {
          tournament_id: "arena-1",
          user_id: "user-1",
          seed: 1,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
        },
        {
          tournament_id: "arena-1",
          user_id: "user-2",
          seed: 2,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
        },
      ])
      .execute();

    await db
      .insertInto("tournament_arena_state")
      .values({
        tournament_id: "arena-1",
        starts_at: 1700000000,
        ends_at: 1700004500,
        problem_count: 4,
        created_at: "2024-01-06T12:00:00.000Z",
        updated_at: "2024-01-06T12:00:00.000Z",
      })
      .execute();

    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map([["guild-1", { name: "Guild One" }]]) },
      } as never,
    });
    const response = await app.request("http://localhost/guilds/guild-1");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Arena");
    expect(body).toContain("problems");
  });

  it("returns 404 for unknown guilds", async () => {
    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map() },
      } as never,
    });
    const response = await app.request("http://localhost/guilds/missing");
    expect(response.status).toBe(404);
  });

  it("renders the status page", async () => {
    await db
      .insertInto("cf_cache")
      .values({
        key: "problemset",
        payload: "[]",
        last_fetched: "2024-01-01T00:00:00.000Z",
      })
      .execute();
    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map([["guild-1", { name: "Guild One" }]]) },
      } as never,
    });
    const response = await app.request("http://localhost/status");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Cache status");
    expect(body).toContain("Problemset cache");
  });

  it("returns cache status as json", async () => {
    await db
      .insertInto("cf_cache")
      .values({
        key: "problemset",
        payload: "[]",
        last_fetched: "2024-01-01T00:00:00.000Z",
      })
      .execute();
    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map([["guild-1", { name: "Guild One" }]]) },
      } as never,
    });
    const response = await app.request("http://localhost/status.json");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      generatedAt: string;
      cacheEntries: Array<{ label: string }>;
    };
    expect(body.generatedAt).toBeTruthy();
    expect(body.cacheEntries.some((entry) => entry.label === "Problemset cache")).toBe(true);
  });

  it("returns health status", async () => {
    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map([["guild-1", { name: "Guild One" }]]) },
      } as never,
    });
    const response = await app.request("http://localhost/healthz");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      dbOk: boolean;
      codeforces: { lastSuccessAt: string | null; lastError: unknown | null };
    };
    expect(body.status).toBe("ok");
    expect(body.dbOk).toBe(true);
    expect(body.codeforces).toBeTruthy();
  });

  it("exports rating leaderboard as csv", async () => {
    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map([["guild-1", { name: "Guild One" }]]) },
      } as never,
    });
    const response = await app.request("http://localhost/guilds/guild-1/exports/rating/csv");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Rank,Handle,User ID,Rating");
    expect(body).toContain("alice");
  });

  it("serves static assets", async () => {
    const app = createWebApp({
      website,
      client: {
        guilds: { cache: new Map() },
      } as never,
    });
    const cssResponse = await app.request("http://localhost/static/styles.css");
    expect(cssResponse.status).toBe(200);
    const cssBody = await cssResponse.text();
    expect(cssBody).toContain(":root");

    const faviconResponse = await app.request("http://localhost/favicon.ico");
    expect(faviconResponse.status).toBe(302);
    expect(faviconResponse.headers.get("location")).toBe("/static/brand-icon.png");
  });
});
