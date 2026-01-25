import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import type { LogContext, LogEntry, LogSink } from "../utils/logger.js";

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
}
