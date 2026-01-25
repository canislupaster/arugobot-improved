import { createServer, type Server } from "node:http";

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
import type { WebServerStatus } from "../../src/types/webStatus.js";
import { startWebServer } from "../../src/web/server.js";

const mockCodeforces = {
  request: jest.fn(),
  getLastError: jest.fn().mockReturnValue(null),
  getLastSuccessAt: jest.fn().mockReturnValue("2024-01-01T00:00:00.000Z"),
} as unknown as CodeforcesClient;

const mockRatingChanges = {
  getRatingChanges: jest.fn().mockResolvedValue(null),
} as unknown as RatingChangesService;

async function createWebsite(): Promise<{ db: Kysely<Database>; website: WebsiteService }> {
  const db = createDb(":memory:");
  await migrateToLatest(db);
  const store = new StoreService(db, mockCodeforces);
  const settings = new GuildSettingsService(db);
  const contestActivity = new ContestActivityService(db, store, mockRatingChanges);
  const website = new WebsiteService(db, store, settings, contestActivity, mockCodeforces);
  return { db, website };
}

async function listenServer(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      server.removeListener("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.removeListener("error", handleError);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? Number(address.port) : port;
      resolve(actualPort);
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, "127.0.0.1");
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function reserveConsecutivePorts(
  count: number,
  attempts = 10
): Promise<{ basePort: number; servers: Server[] }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const servers: Server[] = [];
    try {
      const baseServer = createServer();
      const basePort = await listenServer(baseServer, 0);
      servers.push(baseServer);
      for (let offset = 1; offset < count; offset += 1) {
        const server = createServer();
        await listenServer(server, basePort + offset);
        servers.push(server);
      }
      return { basePort, servers };
    } catch {
      await Promise.all(servers.map((server) => closeServer(server)));
    }
  }
  throw new Error("Failed to reserve consecutive ports.");
}

describe("startWebServer", () => {
  it("starts on a random port when configured", async () => {
    const { db, website } = await createWebsite();
    const status: WebServerStatus = {
      status: "starting",
      host: "127.0.0.1",
      requestedPort: 0,
      actualPort: null,
      lastError: null,
    };

    const server = await startWebServer(
      { host: "127.0.0.1", port: 0 },
      { website, client: { guilds: { cache: new Map() } } as never },
      status
    );

    expect(server).not.toBeNull();
    expect(status.status).toBe("listening");
    expect(status.actualPort).not.toBeNull();

    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await db.destroy();
  });

  it("falls back to a new port when the configured one is already in use", async () => {
    const { db, website } = await createWebsite();
    const status: WebServerStatus = {
      status: "starting",
      host: "127.0.0.1",
      requestedPort: 0,
      actualPort: null,
      lastError: null,
    };

    const server = await startWebServer(
      { host: "127.0.0.1", port: 0 },
      { website, client: { guilds: { cache: new Map() } } as never },
      status
    );
    const occupiedPort = status.actualPort ?? 0;
    expect(occupiedPort).toBeGreaterThan(0);

    const secondStatus: WebServerStatus = {
      status: "starting",
      host: "127.0.0.1",
      requestedPort: occupiedPort,
      actualPort: null,
      lastError: null,
    };
    const secondServer = await startWebServer(
      { host: "127.0.0.1", port: occupiedPort },
      { website, client: { guilds: { cache: new Map() } } as never },
      secondStatus
    );

    expect(secondServer).not.toBeNull();
    expect(secondStatus.status).toBe("listening");
    expect(secondStatus.actualPort).not.toBeNull();
    expect(secondStatus.actualPort).not.toBe(occupiedPort);

    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await new Promise<void>((resolve) => secondServer?.close(() => resolve()));
    await db.destroy();
  });

  it("falls back to a random port when consecutive ports are busy", async () => {
    const { db, website } = await createWebsite();
    const reservation = await reserveConsecutivePorts(3);
    const status: WebServerStatus = {
      status: "starting",
      host: "127.0.0.1",
      requestedPort: reservation.basePort,
      actualPort: null,
      lastError: null,
    };

    const server = await startWebServer(
      { host: "127.0.0.1", port: reservation.basePort },
      { website, client: { guilds: { cache: new Map() } } as never },
      status
    );

    expect(server).not.toBeNull();
    expect(status.status).toBe("listening");
    expect(status.actualPort).not.toBeNull();
    expect(status.actualPort).not.toBe(reservation.basePort);
    expect(status.actualPort).not.toBe(reservation.basePort + 1);
    expect(status.actualPort).not.toBe(reservation.basePort + 2);

    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await Promise.all(reservation.servers.map((reserved) => closeServer(reserved)));
    await db.destroy();
  });
});
