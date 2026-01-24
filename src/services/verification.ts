import { logError, type LogContext } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

export type SubmissionResponse = Array<{
  verdict?: string;
  contestId?: number;
  problem: { index: string; contestId?: number };
  creationTimeSeconds: number;
}>;

export type RequestFn = <T>(
  endpoint: string,
  params?: Record<string, string | number | boolean>
) => Promise<T>;

export type VerificationClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

type CompilationErrorCheckOptions = {
  contestId: number;
  handle: string;
  index: string;
  startTimeSeconds: number;
  timeoutMs: number;
  pollIntervalMs: number;
  logContext: LogContext;
  request: RequestFn;
  clock?: VerificationClock;
};

async function hasCompilationError(
  contestId: number,
  handle: string,
  index: string,
  startTimeSeconds: number,
  logContext: LogContext,
  request: RequestFn
): Promise<boolean> {
  try {
    const result = await request<SubmissionResponse>("contest.status", {
      contestId,
      handle,
      from: 1,
      count: 10,
    });

    for (const submission of result) {
      if (
        submission.problem.index === index &&
        submission.verdict === "COMPILATION_ERROR" &&
        submission.contestId === contestId
      ) {
        return submission.creationTimeSeconds > startTimeSeconds;
      }
    }
  } catch (error) {
    logError(`Error getting submission: ${String(error)}`, logContext);
  }
  return false;
}

export async function waitForCompilationError({
  contestId,
  handle,
  index,
  startTimeSeconds,
  timeoutMs,
  pollIntervalMs,
  logContext,
  request,
  clock,
}: CompilationErrorCheckOptions): Promise<boolean> {
  const timer = clock ?? { now: Date.now, sleep };
  const deadline = timer.now() + timeoutMs;

  while (timer.now() < deadline) {
    const found = await hasCompilationError(
      contestId,
      handle,
      index,
      startTimeSeconds,
      logContext,
      request
    );
    if (found) {
      return true;
    }

    const remainingMs = deadline - timer.now();
    if (remainingMs <= 0) {
      break;
    }
    await timer.sleep(Math.min(pollIntervalMs, remainingMs));
  }

  return false;
}
