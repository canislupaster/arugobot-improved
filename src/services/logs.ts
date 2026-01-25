import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import type { LogContext, LogEntry, LogLevel, LogSink } from "../utils/logger.js";

export const logCleanupIntervalMs = 12 * 60 * 60 * 1000;

type LogContextFields = {
  correlationId?: string;
  command?: string;
  guildId?: string;
  userId?: string;
  latencyMs?: number;
  extraJson: string | null;
};

function splitContext(context?: LogContext): LogContextFields {
  if (!context) {
    return { extraJson: null };
  }
  const { correlationId, command, guildId, userId, latencyMs, ...extra } = context;
  const extraJson = Object.keys(extra).length > 0 ? JSON.stringify(extra) : null;
  return {
    correlationId,
    command,
    guildId,
    userId,
    latencyMs,
    extraJson,
  };
}

export class LogsService implements LogSink {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly retentionDays: number
  ) {}

  async write(entry: LogEntry): Promise<void> {
    const context = splitContext(entry.context);
    await this.db
      .insertInto("log_entries")
      .values({
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        correlation_id: context.correlationId ?? null,
        command: context.command ?? null,
        guild_id: context.guildId ?? null,
        user_id: context.userId ?? null,
        latency_ms: context.latencyMs ?? null,
        context_json: context.extraJson,
      })
      .execute();
  }

  async cleanupOldEntries(): Promise<number> {
    if (this.retentionDays <= 0) {
      return 0;
    }
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.db
      .deleteFrom("log_entries")
      .where("timestamp", "<", cutoff)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0);
  }

  async getCount(): Promise<number> {
    const result = await this.db
      .selectFrom("log_entries")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst();
    return result?.count ?? 0;
  }

  async getRecentEntries(options: {
    limit?: number;
    level?: LogLevel;
    guildId?: string;
    userId?: string;
    command?: string;
  }): Promise<LogEntry[]> {
    const limit = Math.max(1, Math.min(20, options.limit ?? 10));
    let query = this.db
      .selectFrom("log_entries")
      .select([
        "timestamp",
        "level",
        "message",
        "correlation_id",
        "command",
        "guild_id",
        "user_id",
        "latency_ms",
        "context_json",
      ])
      .orderBy("timestamp", "desc")
      .limit(limit);

    if (options.level) {
      query = query.where("level", "=", options.level);
    }
    if (options.guildId) {
      query = query.where("guild_id", "=", options.guildId);
    }
    if (options.userId) {
      query = query.where("user_id", "=", options.userId);
    }
    if (options.command) {
      query = query.where("command", "=", options.command);
    }

    const rows = await query.execute();
    return rows.map((row) => ({
      timestamp: row.timestamp,
      level: row.level as LogLevel,
      message: row.message,
      context: {
        correlationId: row.correlation_id ?? undefined,
        command: row.command ?? undefined,
        guildId: row.guild_id ?? undefined,
        userId: row.user_id ?? undefined,
        latencyMs: row.latency_ms ?? undefined,
        ...parseContextJson(row.context_json),
      },
    }));
  }
}

function parseContextJson(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
