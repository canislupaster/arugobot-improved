import { logWarn } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

export type CodeforcesResponse<T> = {
  status: "OK" | "FAILED";
  result: T;
  comment?: string;
};

type RequestOptions = {
  baseUrl: string;
  requestDelayMs: number;
  timeoutMs: number;
};

class RateLimiter {
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private delayMs: number) {}

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, this.lastRequestAt + this.delayMs - now);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      const result = await task();
      this.lastRequestAt = Date.now();
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

export class CodeforcesClient {
  private limiter: RateLimiter;
  private lastError: { message: string; endpoint: string; timestamp: string } | null = null;
  private lastSuccessAt: string | null = null;

  constructor(private options: RequestOptions) {
    this.limiter = new RateLimiter(options.requestDelayMs);
  }

  async request<T>(
    endpoint: string,
    params: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    const url = new URL(`${this.options.baseUrl}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const attempt = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await fetch(url.toString(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
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
        return await this.limiter.schedule(attempt);
      } catch (error) {
        if (attemptIndex >= retries) {
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
