import { validateConfig } from "../../src/config/env.js";

describe("validateConfig", () => {
  it("returns errors for invalid values", () => {
    const errors = validateConfig({
      discordToken: "",
      databaseUrl: "",
      environment: "test",
      codeforcesApiBaseUrl: "not-a-url",
      codeforcesRequestDelayMs: 0,
      codeforcesTimeoutMs: -5,
      codeforcesStatusTimeoutMs: 0,
      codeforcesSolvedMaxPages: -1,
      proxyFetchUrl: "not-a-url",
      logRetentionDays: -1,
      databaseBackupRetentionDays: -1,
      instanceLockTtlSeconds: 0,
      instanceLockHeartbeatSeconds: 0,
      webHost: "",
      webPort: -1,
      webPublicUrl: "not-a-url",
    });
    expect(errors).toContain("DISCORD_TOKEN is missing.");
    expect(errors).toContain("DATABASE_URL is missing.");
    expect(errors).toContain("CODEFORCES_API_BASE_URL must be a valid http(s) URL.");
    expect(errors).toContain("CODEFORCES_REQUEST_DELAY_MS must be greater than 0.");
    expect(errors).toContain("CODEFORCES_TIMEOUT_MS must be greater than 0.");
    expect(errors).toContain("CODEFORCES_STATUS_TIMEOUT_MS must be greater than 0.");
    expect(errors).toContain("CODEFORCES_SOLVED_MAX_PAGES must be 0 or greater.");
    expect(errors).toContain("PROXY_FETCH_URL must be a valid http(s) URL.");
    expect(errors).toContain("LOG_RETENTION_DAYS must be 0 or greater.");
    expect(errors).toContain("DATABASE_BACKUP_RETENTION_DAYS must be 0 or greater.");
    expect(errors).toContain("INSTANCE_LOCK_TTL_SECONDS must be greater than 0.");
    expect(errors).toContain("INSTANCE_LOCK_HEARTBEAT_SECONDS must be greater than 0.");
    expect(errors).toContain("WEB_HOST is missing.");
    expect(errors).toContain("WEB_PORT must be a valid port number (0-65535).");
    expect(errors).toContain("WEB_PUBLIC_URL must be a valid http(s) URL.");
  });

  it("validates database URL and NODE_ENV", () => {
    const errors = validateConfig({
      discordToken: "token",
      databaseUrl: "postgres://localhost/db",
      environment: "staging" as "test",
      codeforcesApiBaseUrl: "https://codeforces.com/api",
      codeforcesRequestDelayMs: 1000,
      codeforcesTimeoutMs: 1000,
      codeforcesStatusTimeoutMs: 1000,
      codeforcesSolvedMaxPages: 10,
      proxyFetchUrl: "https://example.com/proxies.txt",
      logRetentionDays: 30,
      databaseBackupRetentionDays: 7,
      instanceLockTtlSeconds: 120,
      instanceLockHeartbeatSeconds: 30,
      webHost: "0.0.0.0",
      webPort: 0,
      webPublicUrl: "https://example.com",
    });
    expect(errors).toContain("DATABASE_URL must start with sqlite: (e.g. sqlite:./bot_data.db).");
    expect(errors).toContain("NODE_ENV must be one of development, production, or test.");
    expect(errors).not.toContain("WEB_PORT must be a valid port number (0-65535).");
  });
});
