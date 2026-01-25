import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  discordToken: string;
  databaseUrl: string;
  environment: "development" | "production" | "test";
  discordGuildId?: string;
  codeforcesApiBaseUrl: string;
  codeforcesRequestDelayMs: number;
  codeforcesTimeoutMs: number;
  codeforcesSolvedMaxPages: number;
  proxyFetchUrl?: string;
  logRetentionDays: number;
  webHost: string;
  webPort: number;
  webPublicUrl?: string;
};

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];
  if (!config.discordToken) {
    errors.push("DISCORD_TOKEN is missing.");
  }
  if (!config.databaseUrl) {
    errors.push("DATABASE_URL is missing.");
  }
  if (config.databaseUrl && !config.databaseUrl.startsWith("sqlite:")) {
    errors.push("DATABASE_URL must start with sqlite: (e.g. sqlite:./bot_data.db).");
  }
  if (!isValidUrl(config.codeforcesApiBaseUrl)) {
    errors.push("CODEFORCES_API_BASE_URL must be a valid http(s) URL.");
  }
  if (config.codeforcesRequestDelayMs <= 0) {
    errors.push("CODEFORCES_REQUEST_DELAY_MS must be greater than 0.");
  }
  if (config.codeforcesTimeoutMs <= 0) {
    errors.push("CODEFORCES_TIMEOUT_MS must be greater than 0.");
  }
  if (config.codeforcesSolvedMaxPages < 0) {
    errors.push("CODEFORCES_SOLVED_MAX_PAGES must be 0 or greater.");
  }
  if (config.proxyFetchUrl && !isValidUrl(config.proxyFetchUrl)) {
    errors.push("PROXY_FETCH_URL must be a valid http(s) URL.");
  }
  if (!Number.isFinite(config.logRetentionDays) || config.logRetentionDays < 0) {
    errors.push("LOG_RETENTION_DAYS must be 0 or greater.");
  }
  if (!["development", "production", "test"].includes(config.environment)) {
    errors.push("NODE_ENV must be one of development, production, or test.");
  }
  if (!config.webHost) {
    errors.push("WEB_HOST is missing.");
  }
  if (!Number.isFinite(config.webPort) || config.webPort <= 0 || config.webPort > 65535) {
    errors.push("WEB_PORT must be a valid port number (1-65535).");
  }
  if (config.webPublicUrl && !isValidUrl(config.webPublicUrl)) {
    errors.push("WEB_PUBLIC_URL must be a valid http(s) URL.");
  }
  return errors;
}

export function loadConfig(): AppConfig {
  const discordToken = process.env.DISCORD_TOKEN?.trim() ?? "";
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const environment = (process.env.NODE_ENV as AppConfig["environment"]) ?? "development";
  const discordGuildId = process.env.DISCORD_GUILD_ID?.trim() || undefined;
  const codeforcesApiBaseUrl =
    process.env.CODEFORCES_API_BASE_URL?.trim() || "https://codeforces.com/api";
  const codeforcesRequestDelayMs = parseNumber(
    process.env.CODEFORCES_REQUEST_DELAY_MS ?? "2000",
    2000
  );
  const codeforcesTimeoutMs = parseNumber(process.env.CODEFORCES_TIMEOUT_MS ?? "10000", 10000);
  const codeforcesSolvedMaxPages = parseNumber(process.env.CODEFORCES_SOLVED_MAX_PAGES ?? "10", 10);
  const proxyFetchUrl = process.env.PROXY_FETCH_URL?.trim() || undefined;
  const logRetentionDays = parseNumber(process.env.LOG_RETENTION_DAYS ?? "30", 30);
  const webHost = process.env.WEB_HOST?.trim() || "0.0.0.0";
  const webPort = parseNumber(process.env.WEB_PORT ?? "8787", 8787);
  const webPublicUrlRaw = process.env.WEB_PUBLIC_URL?.trim();
  const webPublicUrl = webPublicUrlRaw ? webPublicUrlRaw.replace(/\/+$/, "") : undefined;

  return {
    discordToken,
    databaseUrl,
    environment,
    discordGuildId,
    codeforcesApiBaseUrl,
    codeforcesRequestDelayMs,
    codeforcesTimeoutMs,
    codeforcesSolvedMaxPages,
    proxyFetchUrl,
    logRetentionDays,
    webHost,
    webPort,
    webPublicUrl,
  };
}
