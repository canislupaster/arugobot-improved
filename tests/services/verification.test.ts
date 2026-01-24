import { waitForCompilationError, type RequestFn } from "../../src/services/verification.js";

describe("waitForCompilationError", () => {
  it("returns true when a compilation error appears during polling", async () => {
    const contestId = 1000;
    const index = "A";
    const startTimeSeconds = 10;
    const submissions = [
      [],
      [
        {
          verdict: "COMPILATION_ERROR",
          contestId,
          problem: { index, contestId },
          creationTimeSeconds: 15,
        },
      ],
    ];
    const request = jest.fn().mockImplementation(async () => submissions.shift() ?? []);

    let now = 0;
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };

    const result = await waitForCompilationError({
      contestId,
      handle: "tourist",
      index,
      startTimeSeconds,
      timeoutMs: 20000,
      pollIntervalMs: 5000,
      logContext: { correlationId: "test-1" },
      request: request as RequestFn,
      clock,
    });

    expect(result).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("returns false when the timeout expires without a matching submission", async () => {
    const request = jest.fn().mockResolvedValue([]);
    let now = 0;
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };

    const result = await waitForCompilationError({
      contestId: 123,
      handle: "neo",
      index: "B",
      startTimeSeconds: 100,
      timeoutMs: 12000,
      pollIntervalMs: 5000,
      logContext: { correlationId: "test-2" },
      request: request as RequestFn,
      clock,
    });

    expect(result).toBe(false);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("stops polling when aborted", async () => {
    const request = jest.fn().mockResolvedValue([]);
    const controller = new AbortController();
    let now = 0;
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
        controller.abort();
      },
    };

    const result = await waitForCompilationError({
      contestId: 321,
      handle: "mika",
      index: "C",
      startTimeSeconds: 100,
      timeoutMs: 20000,
      pollIntervalMs: 5000,
      logContext: { correlationId: "test-3" },
      request: request as RequestFn,
      clock,
      signal: controller.signal,
    });

    expect(result).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
