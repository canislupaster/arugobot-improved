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
  if (!["development", "production", "test"].includes(config.environment)) {
    errors.push("NODE_ENV must be one of development, production, or test.");
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
  const codeforcesSolvedMaxPages = parseNumber(
    process.env.CODEFORCES_SOLVED_MAX_PAGES ?? "10",
    10
  );

  return {
    discordToken,
    databaseUrl,
    environment,
    discordGuildId,
    codeforcesApiBaseUrl,
    codeforcesRequestDelayMs,
    codeforcesTimeoutMs,
    codeforcesSolvedMaxPages,
  };
}
