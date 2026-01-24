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
    });
    expect(errors).toContain("DISCORD_TOKEN is missing.");
    expect(errors).toContain("DATABASE_URL is missing.");
    expect(errors).toContain("CODEFORCES_API_BASE_URL must be a valid http(s) URL.");
    expect(errors).toContain("CODEFORCES_REQUEST_DELAY_MS must be greater than 0.");
    expect(errors).toContain("CODEFORCES_TIMEOUT_MS must be greater than 0.");
  });

  it("validates database URL and NODE_ENV", () => {
    const errors = validateConfig({
      discordToken: "token",
      databaseUrl: "postgres://localhost/db",
      environment: "staging" as "test",
      codeforcesApiBaseUrl: "https://codeforces.com/api",
      codeforcesRequestDelayMs: 1000,
      codeforcesTimeoutMs: 1000,
    });
    expect(errors).toContain("DATABASE_URL must start with sqlite: (e.g. sqlite:./bot_data.db).");
    expect(errors).toContain("NODE_ENV must be one of development, production, or test.");
  });
});
