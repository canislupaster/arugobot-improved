import path from "node:path";

import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import type { Database as DatabaseTypes } from "./types.js";

let dbInstance: Kysely<DatabaseTypes> | null = null;

function resolveDatabasePath(databaseUrl: string): string {
  if (databaseUrl.startsWith("sqlite:")) {
    const rawPath = databaseUrl.replace(/^sqlite:(\/\/)?/, "");
    return path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);
  }
  return databaseUrl;
}

export function createDb(databaseUrl: string): Kysely<DatabaseTypes> {
  const filename = resolveDatabasePath(databaseUrl);
  return new Kysely<DatabaseTypes>({
    dialect: new SqliteDialect({
      database: new Database(filename),
    }),
  });
}

export function getDb(): Kysely<DatabaseTypes> {
  if (!dbInstance) {
    throw new Error("Database not initialized.");
  }
  return dbInstance;
}

export function initDb(databaseUrl: string): Kysely<DatabaseTypes> {
  if (!dbInstance) {
    dbInstance = createDb(databaseUrl);
  }
  return dbInstance;
}

export async function destroyDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
}
