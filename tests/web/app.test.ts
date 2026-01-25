import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import type { CodeforcesClient } from "../../src/services/codeforces.js";
import { ContestActivityService } from "../../src/services/contestActivity.js";
import { GuildSettingsService } from "../../src/services/guildSettings.js";
import { StoreService } from "../../src/services/store.js";
import { WebsiteService } from "../../src/services/website.js";
import { createWebApp } from "../../src/web/app.js";

const mockCodeforces = { request: jest.fn() } as unknown as CodeforcesClient;

describe("web app", () => {
  let db: Kysely<Database>;
  let website: WebsiteService;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    const store = new StoreService(db, mockCodeforces);
    const settings = new GuildSettingsService(db);
    const contestActivity = new ContestActivityService(db, store);
    website = new WebsiteService(db, store, settings, contestActivity);

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
    expect(body).toContain("og:image");
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
    expect(faviconResponse.headers.get("location")).toBe("/static/favicon.svg");
  });
});
