import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { logError, logInfo, logWarn } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

export type GitHubIssueAutomationConfig = {
  repoPath: string;
  worktreePath: string;
  promptPath: string;
  codexLabel: string;
  activeLabel: string;
  defaultRepo?: string;
  maxIterations: number;
  statusCommentMinutes: number;
  iterationCooldownSeconds: number;
};

export type GitHubIssueWebhookPayload = {
  action?: string;
  issue?: {
    number?: number;
    title?: string;
    body?: string | null;
    state?: string;
    labels?: Array<{ name?: string | null }>;
    html_url?: string;
  };
  label?: { name?: string | null };
  repository?: { full_name?: string; default_branch?: string };
  sender?: { login?: string };
};

type IssueJob = {
  number: number;
  title: string;
  body: string;
  url: string;
  repo: string;
  defaultBranch: string;
  requestedBy?: string;
};

type WebhookResult = { status: "ignored" | "accepted" | "rejected"; message: string };

type CommandResult = { stdout: string; stderr: string; exitCode: number };

type CommandRunner = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;

type CodexRunner = (prompt: string, cwd: string, resume: boolean) => Promise<number>;

type IssueAction =
  | { action: "enqueue"; job: IssueJob }
  | { action: "dequeue"; number: number }
  | {
      action: "noop";
    };

const defaultIssueBody = "No issue description provided.";

function normalizeLabel(label?: string | null): string {
  return (label ?? "").trim().toLowerCase();
}

function getLabelNames(labels?: Array<{ name?: string | null }>): string[] {
  return (labels ?? []).map((label) => normalizeLabel(label.name)).filter((name) => Boolean(name));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function resolveIssueAction(
  payload: GitHubIssueWebhookPayload,
  codexLabel: string
): IssueAction {
  const action = payload.action ?? "";
  const issue = payload.issue;
  if (!issue || typeof issue.number !== "number") {
    return { action: "noop" };
  }
  if (issue.state && issue.state !== "open") {
    return { action: "noop" };
  }
  const labelName = normalizeLabel(payload.label?.name);
  const labels = getLabelNames(issue.labels);
  const isCodex = labels.includes(normalizeLabel(codexLabel));

  if (action === "opened" && isCodex) {
    const repo = payload.repository?.full_name;
    if (!repo) {
      return { action: "noop" };
    }
    return {
      action: "enqueue",
      job: {
        number: issue.number,
        title: issue.title ?? `Issue ${issue.number}`,
        body: issue.body ?? defaultIssueBody,
        url: issue.html_url ?? `https://github.com/${repo}/issues/${issue.number}`,
        repo,
        defaultBranch: payload.repository?.default_branch ?? "main",
        requestedBy: payload.sender?.login,
      },
    };
  }

  if (action === "labeled" && labelName === normalizeLabel(codexLabel) && isCodex) {
    const repo = payload.repository?.full_name;
    if (!repo) {
      return { action: "noop" };
    }
    return {
      action: "enqueue",
      job: {
        number: issue.number,
        title: issue.title ?? `Issue ${issue.number}`,
        body: issue.body ?? defaultIssueBody,
        url: issue.html_url ?? `https://github.com/${repo}/issues/${issue.number}`,
        repo,
        defaultBranch: payload.repository?.default_branch ?? "main",
        requestedBy: payload.sender?.login,
      },
    };
  }

  if (action === "unlabeled" && labelName === normalizeLabel(codexLabel) && !isCodex) {
    return { action: "dequeue", number: issue.number };
  }

  return { action: "noop" };
}

async function defaultRunCommand(
  command: string,
  args: string[],
  cwd?: string
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let resolved = false;
    const finalize = (exitCode: number) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve({ stdout, stderr, exitCode });
    };
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += error.message;
      finalize(1);
    });
    child.on("close", (code) => {
      finalize(code ?? 0);
    });
  });
}

async function defaultRunCodex(prompt: string, cwd: string, resume: boolean): Promise<number> {
  const args = resume
    ? [
        "exec",
        "Continue what you were working on.",
        "-C",
        cwd,
        "--dangerously-bypass-approvals-and-sandbox",
        "resume",
        "--last",
      ]
    : ["exec", prompt, "-C", cwd, "--dangerously-bypass-approvals-and-sandbox"];
  return await new Promise((resolve) => {
    const child = spawn("codex", args, { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 0));
  });
}

export class GitHubIssueAutomationService {
  private readonly queue: IssueJob[] = [];
  private active: IssueJob | null = null;
  private processing = false;
  private lastStatusCommentAt: number | null = null;
  private promptCache: string | null = null;
  private readonly runCommand: CommandRunner;
  private readonly runCodex: CodexRunner;

  constructor(
    private readonly config: GitHubIssueAutomationConfig,
    deps?: {
      runCommand?: CommandRunner;
      runCodex?: CodexRunner;
    }
  ) {
    this.runCommand = deps?.runCommand ?? defaultRunCommand;
    this.runCodex = deps?.runCodex ?? defaultRunCodex;
  }

  async initialize() {
    if (this.config.defaultRepo) {
      await this.scanForOpenIssues(this.config.defaultRepo);
    }
  }

  async handleWebhook(
    eventType: string | undefined,
    payload: GitHubIssueWebhookPayload,
    requestId?: string
  ): Promise<WebhookResult> {
    if (eventType === "ping") {
      return { status: "accepted", message: "pong" };
    }
    if (eventType !== "issues") {
      return { status: "ignored", message: "event ignored" };
    }
    const action = resolveIssueAction(payload, this.config.codexLabel);
    if (action.action === "enqueue") {
      this.enqueue(action.job, requestId);
      return { status: "accepted", message: "issue queued" };
    }
    if (action.action === "dequeue") {
      this.dequeue(action.number, requestId);
      return { status: "accepted", message: "issue dequeued" };
    }
    return { status: "ignored", message: "no action" };
  }

  private enqueue(job: IssueJob, requestId?: string) {
    if (
      this.active?.number === job.number ||
      this.queue.some((entry) => entry.number === job.number)
    ) {
      return;
    }
    this.queue.push(job);
    logInfo("GitHub issue queued.", {
      correlationId: requestId,
      issueNumber: job.number,
      repo: job.repo,
      queueSize: this.queue.length,
    });
    if (!this.processing) {
      void this.processQueue();
    }
  }

  private dequeue(issueNumber: number, requestId?: string) {
    const index = this.queue.findIndex((entry) => entry.number === issueNumber);
    if (index === -1) {
      return;
    }
    this.queue.splice(index, 1);
    logInfo("GitHub issue dequeued.", {
      correlationId: requestId,
      issueNumber,
      queueSize: this.queue.length,
    });
  }

  private async processQueue() {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) {
          break;
        }
        this.active = next;
        await this.handleIssue(next);
        this.active = null;
        await this.scanForOpenIssues(next.repo);
      }
    } finally {
      this.processing = false;
    }
  }

  private async handleIssue(job: IssueJob) {
    const branch = `codex/issue-${job.number}-${slugify(job.title) || "work"}`;
    this.lastStatusCommentAt = null;
    await this.ensureWorktree(branch, job.defaultBranch);
    await this.addLabel(job, this.config.activeLabel);
    await this.comment(job, `Codex worker started on branch \`${branch}\`.`);

    let iteration = 0;
    const maxIterations = this.config.maxIterations;
    while (maxIterations === 0 || iteration < maxIterations) {
      iteration += 1;
      const prompt = await this.getIssuePrompt(job, branch);
      logInfo("Starting Codex iteration.", {
        issueNumber: job.number,
        repo: job.repo,
        iteration,
      });
      const exitCode = await this.runCodex(prompt, this.config.worktreePath, iteration > 1);
      if (exitCode !== 0) {
        logWarn("Codex iteration exited non-zero.", {
          issueNumber: job.number,
          repo: job.repo,
          iteration,
          exitCode,
        });
      }

      const isClosed = await this.isIssueClosed(job);
      if (isClosed) {
        await this.comment(job, "Issue appears closed; ending Codex loop.");
        break;
      }
      await this.maybePostStatus(job, iteration);
      if (this.config.iterationCooldownSeconds > 0) {
        await sleep(this.config.iterationCooldownSeconds * 1000);
      }
    }

    await this.removeLabel(job, this.config.activeLabel);
  }

  private async ensureWorktree(branch: string, baseBranch: string) {
    if (existsSync(this.config.worktreePath)) {
      await this.execute(
        "git",
        ["-C", this.config.repoPath, "worktree", "remove", "--force", this.config.worktreePath],
        { action: "worktree-remove" }
      );
    }
    await this.execute(
      "git",
      [
        "-C",
        this.config.repoPath,
        "worktree",
        "add",
        "-B",
        branch,
        this.config.worktreePath,
        baseBranch,
      ],
      { action: "worktree-add", branch, baseBranch }
    );
  }

  private async addLabel(job: IssueJob, label: string) {
    if (!label) {
      return;
    }
    await this.execute(
      "gh",
      ["issue", "edit", String(job.number), "--repo", job.repo, "--add-label", label],
      { action: "label-add", issueNumber: job.number, label }
    );
  }

  private async removeLabel(job: IssueJob, label: string) {
    if (!label) {
      return;
    }
    await this.execute(
      "gh",
      ["issue", "edit", String(job.number), "--repo", job.repo, "--remove-label", label],
      { action: "label-remove", issueNumber: job.number, label }
    );
  }

  private async comment(job: IssueJob, body: string) {
    await this.execute(
      "gh",
      ["issue", "comment", String(job.number), "--repo", job.repo, "--body", body],
      { action: "comment", issueNumber: job.number }
    );
  }

  private async maybePostStatus(job: IssueJob, iteration: number) {
    const now = Date.now();
    const minIntervalMs = this.config.statusCommentMinutes * 60 * 1000;
    if (this.lastStatusCommentAt && now - this.lastStatusCommentAt < minIntervalMs) {
      return;
    }
    this.lastStatusCommentAt = now;
    await this.comment(
      job,
      `Codex progress update: iteration ${iteration} finished. Continuing work on \`${basename(
        this.config.worktreePath
      )}\`.`
    );
  }

  private async isIssueClosed(job: IssueJob): Promise<boolean> {
    const result = await this.execute(
      "gh",
      ["issue", "view", String(job.number), "--repo", job.repo, "--json", "state"],
      { action: "issue-view", issueNumber: job.number }
    );
    if (result.exitCode !== 0) {
      return false;
    }
    try {
      const parsed = JSON.parse(result.stdout) as { state?: string };
      return parsed.state === "CLOSED";
    } catch (error) {
      logWarn("Failed to parse issue state.", {
        issueNumber: job.number,
        repo: job.repo,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async scanForOpenIssues(repo: string) {
    const result = await this.execute(
      "gh",
      [
        "issue",
        "list",
        "--repo",
        repo,
        "--label",
        this.config.codexLabel,
        "--state",
        "open",
        "--json",
        "number,title,labels,body",
      ],
      { action: "issue-list", repo }
    );
    if (result.exitCode !== 0) {
      return;
    }
    try {
      const parsed = JSON.parse(result.stdout) as Array<{
        number: number;
        title: string;
        labels: Array<{ name?: string | null }>;
        body?: string | null;
      }>;
      for (const issue of parsed) {
        const labels = getLabelNames(issue.labels);
        if (!labels.includes(normalizeLabel(this.config.codexLabel))) {
          continue;
        }
        if (
          this.active?.number === issue.number ||
          this.queue.some((entry) => entry.number === issue.number)
        ) {
          continue;
        }
        this.queue.push({
          number: issue.number,
          title: issue.title ?? `Issue ${issue.number}`,
          body: issue.body ?? defaultIssueBody,
          url: `https://github.com/${repo}/issues/${issue.number}`,
          repo,
          defaultBranch: "main",
        });
      }
      if (!this.processing && this.queue.length > 0) {
        void this.processQueue();
      }
    } catch (error) {
      logWarn("Failed to parse codex issue list.", {
        repo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async getIssuePrompt(job: IssueJob, branch: string): Promise<string> {
    if (!this.promptCache) {
      try {
        this.promptCache = (await readFile(this.config.promptPath, "utf-8")).trim();
      } catch (error) {
        logError("Failed to read Codex prompt.", {
          error: error instanceof Error ? error.message : String(error),
          promptPath: this.config.promptPath,
        });
        this.promptCache = "";
      }
    }
    const intro = [
      "You are working on a GitHub issue via automation.",
      `Issue #${job.number}: ${job.title}`,
      `Repo: ${job.repo}`,
      `Issue URL: ${job.url}`,
      "",
      "Task notes:",
      `- Work in the git worktree at ${this.config.worktreePath} on branch ${branch}.`,
      "- Post periodic updates to the GitHub issue.",
      "- Commit and push changes to your branch.",
      "- When the issue is resolved, close it and merge back to main if appropriate.",
      "",
      "Issue body:",
      job.body || defaultIssueBody,
      "",
    ].join("\n");
    return [this.promptCache, intro].filter(Boolean).join("\n\n");
  }

  private async execute(command: string, args: string[], context: Record<string, unknown>) {
    const result = await this.runCommand(command, args, this.config.repoPath);
    if (result.exitCode !== 0) {
      logWarn("Command failed.", {
        ...context,
        command,
        exitCode: result.exitCode,
        stderr: result.stderr.trim(),
      });
    }
    return result;
  }
}
