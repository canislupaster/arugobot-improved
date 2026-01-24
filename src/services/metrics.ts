import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "../db/types.js";
import { logError } from "../utils/logger.js";

export type CommandMetricSummary = {
  name: string;
  count: number;
  successRate: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  lastSeenAt: string;
};

export class MetricsService {
  constructor(private readonly db: Kysely<Database>) {}

  async recordCommandResult(command: string, latencyMs: number, success: boolean): Promise<void> {
    const timestamp = new Date().toISOString();
    const safeLatency = Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : 0;
    const successDelta = success ? 1 : 0;
    const failureDelta = success ? 0 : 1;
    try {
      await this.db
        .insertInto("command_metrics")
        .values({
          command,
          count: 1,
          success_count: successDelta,
          failure_count: failureDelta,
          total_latency_ms: safeLatency,
          max_latency_ms: safeLatency,
          last_seen_at: timestamp,
          updated_at: timestamp,
        })
        .onConflict((oc) =>
          oc.column("command").doUpdateSet({
            count: sql`count + 1`,
            success_count: sql`success_count + ${successDelta}`,
            failure_count: sql`failure_count + ${failureDelta}`,
            total_latency_ms: sql`total_latency_ms + ${safeLatency}`,
            max_latency_ms: sql`max(max_latency_ms, ${safeLatency})`,
            last_seen_at: timestamp,
            updated_at: timestamp,
          })
        )
        .execute();
    } catch (error) {
      logError("Failed to record command metrics.", {
        command,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getCommandCount(): Promise<number> {
    const row = await this.db
      .selectFrom("command_metrics")
      .select(({ fn }) => fn.sum<number>("count").as("count"))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async getUniqueCommandCount(): Promise<number> {
    const row = await this.db
      .selectFrom("command_metrics")
      .select(({ fn }) => fn.count<string>("command").as("count"))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async getLastCommandAt(): Promise<string | null> {
    const row = await this.db
      .selectFrom("command_metrics")
      .select(({ fn }) => fn.max<string>("last_seen_at").as("last"))
      .executeTakeFirst();
    return row?.last ?? null;
  }

  async getCommandUsageSummary(limit = 5): Promise<CommandMetricSummary[]> {
    if (limit <= 0) {
      return [];
    }
    const rows = await this.db
      .selectFrom("command_metrics")
      .select([
        "command",
        "count",
        "success_count",
        "failure_count",
        "total_latency_ms",
        "max_latency_ms",
        "last_seen_at",
      ])
      .orderBy("count", "desc")
      .orderBy("command", "asc")
      .limit(limit)
      .execute();

    return rows.map((row) => {
      const count = Number(row.count ?? 0);
      const successCount = Number(row.success_count ?? 0);
      const totalLatencyMs = Number(row.total_latency_ms ?? 0);
      const avgLatencyMs = count > 0 ? Math.round(totalLatencyMs / count) : 0;
      const successRate = count > 0 ? Math.round((successCount / count) * 100) : 0;
      return {
        name: row.command,
        count,
        successRate,
        avgLatencyMs,
        maxLatencyMs: Number(row.max_latency_ms ?? 0),
        lastSeenAt: row.last_seen_at,
      };
    });
  }

  async resetCommandMetrics(): Promise<void> {
    await this.db.deleteFrom("command_metrics").execute();
  }
}
