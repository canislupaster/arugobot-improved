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
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

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
  if (!isValidUrl(config.codeforcesApiBaseUrl)) {
    errors.push("CODEFORCES_API_BASE_URL must be a valid http(s) URL.");
  }
  if (config.codeforcesRequestDelayMs <= 0) {
    errors.push("CODEFORCES_REQUEST_DELAY_MS must be greater than 0.");
  }
  if (config.codeforcesTimeoutMs <= 0) {
    errors.push("CODEFORCES_TIMEOUT_MS must be greater than 0.");
  }
  return errors;
}

export function loadConfig(): AppConfig {
  const discordToken = requireEnv("DISCORD_TOKEN");
  const databaseUrl = requireEnv("DATABASE_URL");
  const environment =
    (process.env.NODE_ENV as AppConfig["environment"]) ?? "development";
  const discordGuildId = process.env.DISCORD_GUILD_ID?.trim() || undefined;
  const codeforcesApiBaseUrl =
    process.env.CODEFORCES_API_BASE_URL?.trim() || "https://codeforces.com/api";
  const codeforcesRequestDelayMs = parseNumber(
    process.env.CODEFORCES_REQUEST_DELAY_MS ?? "2000",
    2000
  );
  const codeforcesTimeoutMs = parseNumber(
    process.env.CODEFORCES_TIMEOUT_MS ?? "10000",
    10000
  );

  return {
    discordToken,
    databaseUrl,
    environment,
    discordGuildId,
    codeforcesApiBaseUrl,
    codeforcesRequestDelayMs,
    codeforcesTimeoutMs,
  };
}
