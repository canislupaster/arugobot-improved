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
});
