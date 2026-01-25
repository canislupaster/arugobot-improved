import type { Dispatcher } from "undici";

import { logWarn } from "../utils/logger.js";
import { RateLimiter } from "../utils/rateLimiter.js";
import { sleep } from "../utils/sleep.js";

import type { RequestScheduler } from "./requestPool.js";

export type CodeforcesResponse<T> = {
  status: "OK" | "FAILED";
  result: T;
  comment?: string;
};

type RetryableError = Error & { retryable?: boolean };

type RequestOptions = {
  baseUrl: string;
  requestDelayMs: number;
  timeoutMs: number;
  statusTimeoutMs?: number;
  scheduler?: RequestScheduler;
};

export class CodeforcesClient {
  private scheduler: RequestScheduler;
  private lastError: { message: string; endpoint: string; timestamp: string } | null = null;
  private lastSuccessAt: string | null = null;

  constructor(private options: RequestOptions) {
    this.scheduler =
      options.scheduler ??
      (() => {
        const limiter = new RateLimiter(options.requestDelayMs);
        return {
          schedule: <T>(task: (dispatcher?: Dispatcher) => Promise<T>) =>
            limiter.schedule(() => task(undefined)),
        } satisfies RequestScheduler;
      })();
  }

  async request<T>(
    endpoint: string,
    params: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    const url = new URL(`${this.options.baseUrl}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const shouldUseExtendedTimeout =
      endpoint === "contest.status" || endpoint === "user.status";
    const timeoutMs = shouldUseExtendedTimeout
      ? this.options.statusTimeoutMs ?? this.options.timeoutMs
      : this.options.timeoutMs;

    const attempt = async (dispatcher?: Dispatcher) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          ...(dispatcher ? { dispatcher } : {}),
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`) as RetryableError;
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            error.retryable = false;
          }
          throw error;
        }
        const data = (await response.json()) as CodeforcesResponse<T>;
        if (data.status !== "OK") {
          const comment = data.comment ?? "Unknown Codeforces error";
          throw new Error(comment);
        }
        this.lastSuccessAt = new Date().toISOString();
        return data.result;
      } finally {
        clearTimeout(timeout);
      }
    };

    const retries = 2;
    for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
      try {
        return await this.scheduler.schedule(attempt);
      } catch (error) {
        const retryable =
          !(error instanceof Error) ||
          (error as RetryableError).retryable === undefined ||
          (error as RetryableError).retryable === true;
        if (!retryable || attemptIndex >= retries) {
          const message = error instanceof Error ? error.message : String(error);
          this.lastError = {
            message,
            endpoint,
            timestamp: new Date().toISOString(),
          };
          throw error;
        }
        const waitMs = this.options.requestDelayMs * (attemptIndex + 1);
        logWarn("Codeforces request failed, retrying.", {
          endpoint,
          waitMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(waitMs);
      }
    }

    throw new Error("Unreachable");
  }

  getLastError() {
    return this.lastError;
  }

  getLastSuccessAt() {
    return this.lastSuccessAt;
  }
}
