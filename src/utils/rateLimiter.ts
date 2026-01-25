import { sleep } from "./sleep.js";

export class RateLimiter {
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
      try {
        return await task();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
