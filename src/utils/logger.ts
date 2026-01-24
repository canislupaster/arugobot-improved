export type LogContext = Record<string, unknown> & {
  correlationId?: string;
  command?: string;
  guildId?: string;
  userId?: string;
  latencyMs?: number;
};

type LogLevel = "info" | "warn" | "error";

let lastError: { message: string; context?: LogContext; timestamp: string } | null = null;

function write(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ?? {}),
  };

  if (level === "error") {
    lastError = { message, context, timestamp: entry.timestamp };
  }

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function logInfo(message: string, context?: LogContext) {
  write("info", message, context);
}

export function logWarn(message: string, context?: LogContext) {
  write("warn", message, context);
}

export function logError(message: string, context?: LogContext) {
  write("error", message, context);
}

export function getLastError() {
  return lastError;
}
