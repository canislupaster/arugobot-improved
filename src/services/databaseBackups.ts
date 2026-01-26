import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

import { logError, logInfo, logWarn } from "../utils/logger.js";

export const databaseBackupIntervalMs = 6 * 60 * 60 * 1000;

type BackupResult =
  | { status: "disabled" }
  | { status: "skipped"; reason: string }
  | { status: "success"; filePath: string; deletedCount: number; durationMs: number };

export class DatabaseBackupService {
  private lastBackupAt: string | null = null;
  private lastError: { message: string; timestamp: string } | null = null;
  private readonly databasePath: string | null;

  constructor(
    private readonly databaseUrl: string,
    private readonly backupDir: string | null,
    private readonly retentionDays: number
  ) {
    this.databasePath = resolveSqlitePath(databaseUrl);
  }

  getLastBackupAt(): string | null {
    return this.lastBackupAt;
  }

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  getBackupDir(): string | null {
    return this.backupDir;
  }

  async runBackup(): Promise<BackupResult> {
    if (!this.backupDir) {
      return { status: "disabled" };
    }
    if (!this.databasePath) {
      const message = `Database backup skipped (unsupported DATABASE_URL: ${this.databaseUrl}).`;
      this.recordFailure(message, "warn");
      return { status: "skipped", reason: "unsupported_database_url" };
    }

    const startedAt = Date.now();
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      const { backupPath } = await this.resolveBackupPath(startedAt);
      await fs.copyFile(this.databasePath, backupPath, fsConstants.COPYFILE_EXCL);
      const deletedCount = await this.cleanupOldBackups(Date.now());
      this.lastBackupAt = new Date().toISOString();
      this.lastError = null;
      logInfo("Database backup created.", {
        path: backupPath,
        deletedCount,
        durationMs: Date.now() - startedAt,
      });
      return {
        status: "success",
        filePath: backupPath,
        deletedCount,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordFailure(message, "error");
      return { status: "skipped", reason: message };
    }
  }

  private async cleanupOldBackups(nowMs: number): Promise<number> {
    if (!this.backupDir || this.retentionDays <= 0) {
      return 0;
    }
    const cutoffMs = nowMs - this.retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    let entries: Array<import("node:fs").Dirent> = [];
    try {
      entries = await fs.readdir(this.backupDir, { withFileTypes: true });
    } catch (error) {
      logWarn("Database backup cleanup failed to read directory.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const timestampSeconds = Number(entry.name);
      if (!Number.isFinite(timestampSeconds)) {
        continue;
      }
      if (timestampSeconds * 1000 >= cutoffMs) {
        continue;
      }
      const filePath = path.join(this.backupDir, entry.name);
      try {
        await fs.unlink(filePath);
        deleted += 1;
      } catch (error) {
        logWarn("Failed to delete old database backup.", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (deleted > 0) {
      logInfo("Database backup cleanup complete.", { deleted });
    }
    return deleted;
  }

  private recordFailure(message: string, level: "warn" | "error"): void {
    this.lastError = { message, timestamp: new Date().toISOString() };
    if (level === "warn") {
      logWarn(message);
      return;
    }
    logError("Database backup failed.", { error: message });
  }

  private async resolveBackupPath(
    nowMs: number
  ): Promise<{ backupPath: string; timestampSeconds: number }> {
    if (!this.backupDir) {
      throw new Error("Backup directory not configured.");
    }
    const baseSeconds = Math.floor(nowMs / 1000);
    const maxAttempts = 5;
    for (let offset = 0; offset <= maxAttempts; offset += 1) {
      const timestampSeconds = baseSeconds + offset;
      const backupPath = path.join(this.backupDir, String(timestampSeconds));
      try {
        await fs.access(backupPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return { backupPath, timestampSeconds };
        }
        throw error;
      }
    }
    const timestampSeconds = baseSeconds + maxAttempts + 1;
    return { backupPath: path.join(this.backupDir, String(timestampSeconds)), timestampSeconds };
  }
}

function resolveSqlitePath(databaseUrl: string): string | null {
  if (!databaseUrl.startsWith("sqlite:")) {
    return null;
  }
  const raw = databaseUrl.slice("sqlite:".length);
  if (!raw || raw === ":memory:") {
    return null;
  }
  const normalized = raw.startsWith("//") ? raw.slice(2) : raw;
  return path.resolve(normalized);
}
