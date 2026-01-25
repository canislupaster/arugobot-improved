export type LogContext = Record<string, unknown> & {
  correlationId?: string;
  command?: string;
  guildId?: string;
  userId?: string;
  latencyMs?: number;
};

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
};

export type LogSink = {
  write(entry: LogEntry): Promise<void>;
};

let lastError: { message: string; context?: LogContext; timestamp: string } | null = null;
let logSink: LogSink | null = null;

export function setLogSink(sink: LogSink | null) {
  logSink = sink;
}

function shouldSuppressSinkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
  if (!message) {
    return false;
  }
  const lowered = message.toLowerCase();
  return (
    lowered.includes("driver has already been destroyed") || lowered.includes("database is closed")
  );
}

function write(level: LogLevel, message: string, context?: LogContext) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    message,
    ...(context ?? {}),
  };

  if (level === "error") {
    lastError = { message, context, timestamp };
  }

  if (logSink) {
    const sinkEntry: LogEntry = {
      timestamp,
      level,
      message,
      context,
    };
    void logSink.write(sinkEntry).catch((error) => {
      if (shouldSuppressSinkError(error)) {
        return;
      }
      const fallback = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Log sink failed.",
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(fallback);
    });
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
