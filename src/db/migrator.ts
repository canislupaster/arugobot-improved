import { promises as fs } from "node:fs";
import path from "node:path";

import { FileMigrationProvider, Migrator, type Kysely } from "kysely";

import type { Database } from "./types.js";

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrationsFolder = await resolveMigrationsFolder();
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: migrationsFolder,
    }),
  });

  const { error } = await migrator.migrateToLatest();
  if (error) {
    throw error;
  }
}

async function resolveMigrationsFolder(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), "src", "db", "migrations"),
    path.join(process.cwd(), "dist", "db", "migrations"),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return candidates[0];
}
