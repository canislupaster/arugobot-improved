import {
  resolveIssueAction,
  type GitHubIssueWebhookPayload,
} from "../../src/services/githubIssueAutomation.js";

describe("resolveIssueAction", () => {
  it("enqueues when issue is opened with the codex label", () => {
    const payload: GitHubIssueWebhookPayload = {
      action: "opened",
      issue: {
        number: 42,
        title: "Add webhook",
        body: "body",
        labels: [{ name: "codex" }],
        html_url: "https://github.com/org/repo/issues/42",
      },
      repository: { full_name: "org/repo", default_branch: "main" },
      sender: { login: "alice" },
    };
    const action = resolveIssueAction(payload, "codex");
    expect(action.action).toBe("enqueue");
    if (action.action === "enqueue") {
      expect(action.job.number).toBe(42);
      expect(action.job.repo).toBe("org/repo");
      expect(action.job.requestedBy).toBe("alice");
    }
  });

  it("enqueues when codex label is added", () => {
    const payload: GitHubIssueWebhookPayload = {
      action: "labeled",
      label: { name: "codex" },
      issue: {
        number: 7,
        title: "Need automation",
        labels: [{ name: "codex" }],
      },
      repository: { full_name: "org/repo" },
    };
    const action = resolveIssueAction(payload, "codex");
    expect(action.action).toBe("enqueue");
  });

  it("dequeues when codex label is removed", () => {
    const payload: GitHubIssueWebhookPayload = {
      action: "unlabeled",
      label: { name: "codex" },
      issue: {
        number: 7,
        title: "Need automation",
        labels: [{ name: "other" }],
      },
      repository: { full_name: "org/repo" },
    };
    const action = resolveIssueAction(payload, "codex");
    expect(action).toEqual({ action: "dequeue", number: 7 });
  });

  it("ignores unrelated actions", () => {
    const payload: GitHubIssueWebhookPayload = {
      action: "opened",
      issue: {
        number: 1,
        title: "No label",
        labels: [{ name: "bug" }],
      },
      repository: { full_name: "org/repo" },
    };
    const action = resolveIssueAction(payload, "codex");
    expect(action.action).toBe("noop");
  });
});
