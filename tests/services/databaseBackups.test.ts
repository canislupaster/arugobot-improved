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

  it("records an error for unsupported database urls", async () => {
    const service = new DatabaseBackupService("postgres://localhost/db", "/tmp", 7);
    const result = await service.runBackup();
    expect(result).toEqual({ status: "skipped", reason: "unsupported_database_url" });
    const lastError = service.getLastError();
    expect(lastError?.message).toContain("unsupported DATABASE_URL");
  });

  it("uses the next second when a backup name already exists", async () => {
    const rootDir = await createTempDir();
    const backupDir = path.join(rootDir, "backups");
    await fs.mkdir(backupDir, { recursive: true });
    const dbPath = path.join(rootDir, "bot_data.db");
    await fs.writeFile(dbPath, "test-data");

    const fixedNow = Date.parse("2024-02-01T00:00:00.000Z");
    const dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const nowSeconds = Math.floor(fixedNow / 1000);
      await fs.writeFile(path.join(backupDir, String(nowSeconds)), "existing");

      const service = new DatabaseBackupService(`sqlite:${dbPath}`, backupDir, 7);
      const result = await service.runBackup();
      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.filePath).toBe(path.join(backupDir, String(nowSeconds + 1)));
      }
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});
