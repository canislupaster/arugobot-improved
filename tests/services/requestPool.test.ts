import { createRequestPool } from "../../src/services/requestPool.js";

describe("createRequestPool", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns a direct-only pool when no proxy URL provided", async () => {
    const pool = await createRequestPool({ requestDelayMs: 0 });
    expect(pool.size()).toBe(1);
  });

  it("adds proxies from fetch response", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        ["127.0.0.1:8080", "10.0.0.2:3128:user:pass", "bad:format:line"].join("\n"),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const pool = await createRequestPool({
      proxyFetchUrl: "https://example.com/proxies.txt",
      requestDelayMs: 0,
    });

    expect(pool.size()).toBe(3);
  });

  it("falls back to direct slot when proxy fetch fails", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const pool = await createRequestPool({
      proxyFetchUrl: "https://example.com/proxies.txt",
      requestDelayMs: 0,
    });

    expect(pool.size()).toBe(1);
  });
});
