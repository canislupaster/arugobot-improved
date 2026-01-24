type CommandMetric = {
  count: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
  lastSeenAt: string;
};

type CommandMetricSummary = {
  name: string;
  count: number;
  successRate: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  lastSeenAt: string;
};

const commandMetrics = new Map<string, CommandMetric>();
let commandCount = 0;
let lastCommandAt: string | null = null;

function getOrCreateMetric(command: string, timestamp: string): CommandMetric {
  const existing = commandMetrics.get(command);
  if (existing) {
    return existing;
  }
  const metric: CommandMetric = {
    count: 0,
    successCount: 0,
    failureCount: 0,
    totalLatencyMs: 0,
    maxLatencyMs: 0,
    lastSeenAt: timestamp,
  };
  commandMetrics.set(command, metric);
  return metric;
}

export function recordCommandResult(command: string, latencyMs: number, success: boolean): void {
  const timestamp = new Date().toISOString();
  const safeLatency = Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : 0;
  commandCount += 1;
  lastCommandAt = timestamp;
  const metric = getOrCreateMetric(command, timestamp);
  metric.count += 1;
  metric.totalLatencyMs += safeLatency;
  metric.maxLatencyMs = Math.max(metric.maxLatencyMs, safeLatency);
  metric.lastSeenAt = timestamp;
  if (success) {
    metric.successCount += 1;
  } else {
    metric.failureCount += 1;
  }
}

export function getCommandCount(): number {
  return commandCount;
}

export function getUniqueCommandCount(): number {
  return commandMetrics.size;
}

export function getLastCommandAt(): string | null {
  return lastCommandAt;
}

export function getCommandUsageSummary(limit = 5): CommandMetricSummary[] {
  const summaries = Array.from(commandMetrics.entries()).map(([name, metric]) => {
    const avgLatencyMs = metric.count > 0 ? Math.round(metric.totalLatencyMs / metric.count) : 0;
    const successRate =
      metric.count > 0 ? Math.round((metric.successCount / metric.count) * 100) : 0;
    return {
      name,
      count: metric.count,
      successRate,
      avgLatencyMs,
      maxLatencyMs: metric.maxLatencyMs,
      lastSeenAt: metric.lastSeenAt,
    };
  });
  return summaries
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

export function resetCommandMetrics(): void {
  commandMetrics.clear();
  commandCount = 0;
  lastCommandAt = null;
}
