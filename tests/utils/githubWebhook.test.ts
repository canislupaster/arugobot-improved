import { computeGitHubSignature, verifyGitHubSignature } from "../../src/utils/githubWebhook.js";

describe("github webhook signature", () => {
  it("verifies valid signatures", () => {
    const secret = "supersecret";
    const payload = JSON.stringify({ hello: "world" });
    const signature = computeGitHubSignature(secret, payload);
    expect(verifyGitHubSignature(secret, payload, signature)).toBe(true);
  });

  it("rejects invalid signatures", () => {
    const secret = "supersecret";
    const payload = JSON.stringify({ hello: "world" });
    expect(verifyGitHubSignature(secret, payload, "sha256=deadbeef")).toBe(false);
  });
});
