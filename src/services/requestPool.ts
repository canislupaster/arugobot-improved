import type { Dispatcher } from "undici";
import { ProxyAgent } from "undici";

import { logInfo, logWarn } from "../utils/logger.js";
import { RateLimiter } from "../utils/rateLimiter.js";

export type RequestScheduler = {
  schedule<T>(task: (dispatcher?: Dispatcher) => Promise<T>): Promise<T>;
};

type RequestSlot = {
  dispatcher?: Dispatcher;
  limiter: RateLimiter;
  label: string;
};

type CreateRequestPoolOptions = {
  proxyFetchUrl?: string;
  requestDelayMs: number;
};

export class RequestPool implements RequestScheduler {
  private slots: RequestSlot[];
  private nextIndex = 0;

  constructor(slots: RequestSlot[]) {
    if (slots.length === 0) {
      throw new Error("RequestPool must include at least one slot.");
    }
    this.slots = slots;
  }

  size() {
    return this.slots.length;
  }

  schedule<T>(task: (dispatcher?: Dispatcher) => Promise<T>): Promise<T> {
    const slot = this.slots[this.nextIndex];
    this.nextIndex = (this.nextIndex + 1) % this.slots.length;
    return slot.limiter.schedule(() => task(slot.dispatcher));
  }
}

type ProxyDefinition = {
  host: string;
  port: string;
  username?: string;
  password?: string;
};

function parseProxyLine(line: string): ProxyDefinition | null {
  const parts = line.split(":").map((part) => part.trim());
  if (parts.length !== 2 && parts.length !== 4) {
    return null;
  }
  const [host, port, username, password] = parts;
  if (!host || !port) {
    return null;
  }
  return { host, port, username, password };
}

function buildProxyAgent(proxy: ProxyDefinition): ProxyAgent {
  const auth =
    proxy.username && proxy.password
      ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`
      : undefined;
  return new ProxyAgent({
    uri: `http://${proxy.host}:${proxy.port}`,
    token: auth,
  });
}

export async function createRequestPool(options: CreateRequestPoolOptions): Promise<RequestPool> {
  const slots: RequestSlot[] = [
    {
      label: "direct",
      limiter: new RateLimiter(options.requestDelayMs),
    },
  ];

  if (!options.proxyFetchUrl) {
    return new RequestPool(slots);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(options.proxyFetchUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`Proxy fetch HTTP ${response.status}`);
    }
    const body = await response.text();
    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    let added = 0;
    for (const line of lines) {
      const proxy = parseProxyLine(line);
      if (!proxy) {
        logWarn("Skipping invalid proxy entry.", { entry: line });
        continue;
      }
      slots.push({
        label: `${proxy.host}:${proxy.port}`,
        dispatcher: buildProxyAgent(proxy),
        limiter: new RateLimiter(options.requestDelayMs),
      });
      added += 1;
    }
    logInfo("Proxy pool initialized.", { proxies: added, totalSlots: slots.length });
  } catch (error) {
    logWarn("Proxy fetch failed; continuing without proxies.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return new RequestPool(slots);
}
