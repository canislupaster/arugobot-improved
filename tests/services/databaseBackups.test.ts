import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DatabaseBackupService } from "../../src/services/databaseBackups.js";

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "arugobot-backup-"));
}

describe("DatabaseBackupService", () => {
  it("creates a backup and removes expired files", async () => {
    const rootDir = await createTempDir();
    const backupDir = path.join(rootDir, "backups");
    await fs.mkdir(backupDir, { recursive: true });
    const dbPath = path.join(rootDir, "bot_data.db");
    await fs.writeFile(dbPath, "test-data");

    const oldEpochSeconds = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    const oldBackupPath = path.join(backupDir, String(oldEpochSeconds));
    await fs.writeFile(oldBackupPath, "old-data");

    const service = new DatabaseBackupService(`sqlite:${dbPath}`, backupDir, 7);
    const result = await service.runBackup();
    expect(result.status).toBe("success");

    const entries = await fs.readdir(backupDir);
    expect(entries).not.toContain(String(oldEpochSeconds));
    expect(entries.length).toBeGreaterThan(0);
  });

  it("skips backups when disabled", async () => {
    const service = new DatabaseBackupService("sqlite:./bot_data.db", null, 7);
    const result = await service.runBackup();
    expect(result.status).toBe("disabled");
  });
});
