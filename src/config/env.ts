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
  codeforcesStatusTimeoutMs: number;
  codeforcesSolvedMaxPages: number;
  proxyFetchUrl?: string;
  logRetentionDays: number;
  databaseBackupDir?: string;
  databaseBackupRetentionDays: number;
  codexLogPath?: string;
  webHost: string;
  webPort: number;
  webPublicUrl?: string;
  githubWebhookSecret?: string;
  githubCodexLabel: string;
  githubActiveLabel: string;
  githubRepo?: string;
  codexPromptPath: string;
  codexWorktreePath: string;
  codexMaxIterations: number;
  codexStatusCommentMinutes: number;
  codexIterationCooldownSeconds: number;
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
  if (config.codeforcesStatusTimeoutMs <= 0) {
    errors.push("CODEFORCES_STATUS_TIMEOUT_MS must be greater than 0.");
  }
  if (config.codeforcesSolvedMaxPages < 0) {
    errors.push("CODEFORCES_SOLVED_MAX_PAGES must be 0 or greater.");
  }
  if (config.proxyFetchUrl && !isValidUrl(config.proxyFetchUrl)) {
    errors.push("PROXY_FETCH_URL must be a valid http(s) URL.");
  }
  if (config.codexLogPath !== undefined && !config.codexLogPath) {
    errors.push("CODEX_LOG_PATH must be a non-empty path when set.");
  }
  if (!Number.isFinite(config.logRetentionDays) || config.logRetentionDays < 0) {
    errors.push("LOG_RETENTION_DAYS must be 0 or greater.");
  }
  if (
    !Number.isFinite(config.databaseBackupRetentionDays) ||
    config.databaseBackupRetentionDays < 0
  ) {
    errors.push("DATABASE_BACKUP_RETENTION_DAYS must be 0 or greater.");
  }
  if (!["development", "production", "test"].includes(config.environment)) {
    errors.push("NODE_ENV must be one of development, production, or test.");
  }
  if (!config.webHost) {
    errors.push("WEB_HOST is missing.");
  }
  if (!Number.isFinite(config.webPort) || config.webPort < 0 || config.webPort > 65535) {
    errors.push("WEB_PORT must be a valid port number (0-65535).");
  }
  if (config.webPublicUrl && !isValidUrl(config.webPublicUrl)) {
    errors.push("WEB_PUBLIC_URL must be a valid http(s) URL.");
  }
  if (config.githubWebhookSecret !== undefined && !config.githubWebhookSecret) {
    errors.push("GITHUB_WEBHOOK_SECRET must be a non-empty value when set.");
  }
  if (!config.githubCodexLabel) {
    errors.push("GITHUB_CODEX_LABEL must be a non-empty label.");
  }
  if (!config.githubActiveLabel) {
    errors.push("GITHUB_ACTIVE_LABEL must be a non-empty label.");
  }
  if (!config.codexPromptPath) {
    errors.push("CODEX_PROMPT_PATH must be set.");
  }
  if (!config.codexWorktreePath) {
    errors.push("CODEX_WORKTREE_PATH must be set.");
  }
  if (!Number.isFinite(config.codexMaxIterations) || config.codexMaxIterations < 0) {
    errors.push("CODEX_MAX_ITERATIONS must be 0 or greater.");
  }
  if (!Number.isFinite(config.codexStatusCommentMinutes) || config.codexStatusCommentMinutes <= 0) {
    errors.push("CODEX_STATUS_COMMENT_MINUTES must be greater than 0.");
  }
  if (
    !Number.isFinite(config.codexIterationCooldownSeconds) ||
    config.codexIterationCooldownSeconds < 0
  ) {
    errors.push("CODEX_ITERATION_COOLDOWN_SECONDS must be 0 or greater.");
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
  const codeforcesStatusTimeoutMs = parseNumber(
    process.env.CODEFORCES_STATUS_TIMEOUT_MS ?? "20000",
    20000
  );
  const codeforcesSolvedMaxPages = parseNumber(process.env.CODEFORCES_SOLVED_MAX_PAGES ?? "10", 10);
  const proxyFetchUrl = process.env.PROXY_FETCH_URL?.trim() || undefined;
  const logRetentionDays = parseNumber(process.env.LOG_RETENTION_DAYS ?? "30", 30);
  const databaseBackupDir = process.env.DATABASE_BACKUP?.trim() || undefined;
  const databaseBackupRetentionDays = parseNumber(
    process.env.DATABASE_BACKUP_RETENTION_DAYS ?? "7",
    7
  );
  const codexLogPath = process.env.CODEX_LOG_PATH?.trim() || undefined;
  const webHost = process.env.WEB_HOST?.trim() || "0.0.0.0";
  const webPort = parseNumber(process.env.WEB_PORT ?? "8787", 8787);
  const webPublicUrlRaw = process.env.WEB_PUBLIC_URL?.trim();
  const webPublicUrl = webPublicUrlRaw ? webPublicUrlRaw.replace(/\/+$/, "") : undefined;
  const githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET?.trim() || undefined;
  const githubCodexLabel = process.env.GITHUB_CODEX_LABEL?.trim() || "codex";
  const githubActiveLabel = process.env.GITHUB_ACTIVE_LABEL?.trim() || "active";
  const githubRepo = process.env.GITHUB_REPO?.trim() || undefined;
  const codexPromptPath = process.env.CODEX_PROMPT_PATH?.trim() || "/home/codex/prompt.txt";
  const codexWorktreePath = process.env.CODEX_WORKTREE_PATH?.trim() || "/home/codex/arugobot-work";
  const codexMaxIterations = parseNumber(process.env.CODEX_MAX_ITERATIONS ?? "0", 0);
  const codexStatusCommentMinutes = parseNumber(
    process.env.CODEX_STATUS_COMMENT_MINUTES ?? "30",
    30
  );
  const codexIterationCooldownSeconds = parseNumber(
    process.env.CODEX_ITERATION_COOLDOWN_SECONDS ?? "10",
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
    codeforcesStatusTimeoutMs,
    codeforcesSolvedMaxPages,
    proxyFetchUrl,
    logRetentionDays,
    databaseBackupDir,
    databaseBackupRetentionDays,
    codexLogPath,
    webHost,
    webPort,
    webPublicUrl,
    githubWebhookSecret,
    githubCodexLabel,
    githubActiveLabel,
    githubRepo,
    codexPromptPath,
    codexWorktreePath,
    codexMaxIterations,
    codexStatusCommentMinutes,
    codexIterationCooldownSeconds,
  };
}
