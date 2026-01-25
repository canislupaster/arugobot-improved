import type { Dispatcher } from "undici";

import { CodeforcesClient } from "../../src/services/codeforces.js";
import type { RequestScheduler } from "../../src/services/requestPool.js";

describe("CodeforcesClient", () => {
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
});
