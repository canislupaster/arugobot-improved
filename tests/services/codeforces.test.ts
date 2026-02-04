import type { Dispatcher } from "undici";

import { CodeforcesClient } from "../../src/services/codeforces.js";
import type { RequestScheduler } from "../../src/services/requestPool.js";

const immediateScheduler: RequestScheduler = {
  schedule: (task) => task(undefined),
};

describe("CodeforcesClient", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns parsed result on OK status", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "OK", result: { hello: "world" } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodeforcesClient({
      baseUrl: "https://codeforces.com/api",
      requestDelayMs: 0,
      timeoutMs: 1000,
      scheduler: immediateScheduler,
    });

    const result = await client.request<{ hello: string }>("user.info", { handles: "tourist" });
    expect(result.hello).toBe("world");
  });

  it("throws after failed status", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "FAILED", result: null, comment: "Call limit exceeded" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodeforcesClient({
      baseUrl: "https://codeforces.com/api",
      requestDelayMs: 0,
      timeoutMs: 1000,
      scheduler: immediateScheduler,
    });

    await expect(client.request("user.info", { handles: "tourist" })).rejects.toThrow(
      "Call limit exceeded"
    );
  });

  it("passes scheduler dispatcher into fetch options", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "OK", result: { ok: true } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const dispatcher = { name: "proxy" } as unknown as Dispatcher;
    const scheduler: RequestScheduler = {
      schedule: (task) => task(dispatcher),
    };

    const client = new CodeforcesClient({
      baseUrl: "https://codeforces.com/api",
      requestDelayMs: 0,
      timeoutMs: 1000,
      scheduler,
    });

    await client.request("contest.list");
    const options = fetchMock.mock.calls[0]?.[1] as { dispatcher?: unknown } | undefined;
    expect(options?.dispatcher).toBe(dispatcher);
  });

  it("uses extended timeout for status endpoints", async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "OK", result: { ok: true } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodeforcesClient({
      baseUrl: "https://codeforces.com/api",
      requestDelayMs: 0,
      timeoutMs: 1000,
      statusTimeoutMs: 5000,
    });

    await client.request("contest.status", { contestId: 1, handle: "tourist" });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    jest.useRealTimers();
    setTimeoutSpy.mockRestore();
  });

  it("does not retry on 404 responses", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ status: "FAILED", result: null }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodeforcesClient({
      baseUrl: "https://codeforces.com/api",
      requestDelayMs: 0,
      timeoutMs: 1000,
      scheduler: immediateScheduler,
    });

    await expect(client.request("contest.list")).rejects.toThrow("HTTP 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 500 responses", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ status: "FAILED", result: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "OK", result: { ok: true } }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodeforcesClient({
      baseUrl: "https://codeforces.com/api",
      requestDelayMs: 0,
      timeoutMs: 1000,
      scheduler: immediateScheduler,
    });

    const result = await client.request<{ ok: boolean }>("contest.list");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces timeout errors for aborted requests", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    const fetchMock = jest.fn().mockRejectedValue(abortError);
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodeforcesClient({
      baseUrl: "https://codeforces.com/api",
      requestDelayMs: 0,
      timeoutMs: 1234,
      scheduler: immediateScheduler,
    });

    await expect(client.request("contest.list")).rejects.toThrow(
      "Request timed out after 1234ms"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats aborted messages as timeouts even without AbortError", async () => {
    const abortError = new Error("The operation was aborted");
    const fetchMock = jest.fn().mockRejectedValue(abortError);
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodeforcesClient({
      baseUrl: "https://codeforces.com/api",
      requestDelayMs: 0,
      timeoutMs: 1500,
      scheduler: immediateScheduler,
    });

    await expect(client.request("contest.list")).rejects.toThrow(
      "Request timed out after 1500ms"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
