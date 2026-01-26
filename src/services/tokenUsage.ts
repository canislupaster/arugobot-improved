import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { TextDecoder } from "node:util";

import { logWarn } from "../utils/logger.js";

export type TokenImpactEstimate = {
  energyKwh: number;
  waterLiters: number;
  carbonKg: number;
  assumptions: {
    model: string;
    energyWhPerQuery: number;
    latencySeconds: number;
    tokensPerSecond: number;
    wueSourceLitersPerKwh: number;
    carbonKgPerKwh: number;
  };
};

export type TokenUsageSnapshot = {
  totalTokens: number;
  lastUpdatedAt: string | null;
  impact: TokenImpactEstimate;
};

const TOKEN_MARKER = "tokens used";
const GPT5_MEDIUM_ASSUMPTIONS = {
  model: "GPT-5 (medium)",
  energyWhPerQuery: 13.27,
  latencySeconds: 51,
  tokensPerSecond: 121,
  wueSourceLitersPerKwh: 4.35,
  carbonKgPerKwh: 0.34,
};

function parseTokenCount(line: string): number | null {
  const cleaned = line.replace(/,/g, "");
  const match = cleaned.match(/\d+/);
  if (!match) {
    return null;
  }
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function estimateImpact(totalTokens: number): TokenImpactEstimate {
  const tokensPerQuery = GPT5_MEDIUM_ASSUMPTIONS.latencySeconds * GPT5_MEDIUM_ASSUMPTIONS.tokensPerSecond;
  const energyWhPerToken = tokensPerQuery > 0 ? GPT5_MEDIUM_ASSUMPTIONS.energyWhPerQuery / tokensPerQuery : 0;
  const energyKwh = (totalTokens * energyWhPerToken) / 1000;
  const waterLiters = energyKwh * GPT5_MEDIUM_ASSUMPTIONS.wueSourceLitersPerKwh;
  const carbonKg = energyKwh * GPT5_MEDIUM_ASSUMPTIONS.carbonKgPerKwh;
  return {
    energyKwh,
    waterLiters,
    carbonKg,
    assumptions: { ...GPT5_MEDIUM_ASSUMPTIONS },
  };
}

export class TokenUsageService {
  private totalTokens = 0;
  private lastOffset = 0;
  private pendingLine = "";
  private awaitingValue = false;
  private lastUpdatedAt: string | null = null;
  private lastError: { message: string; timestamp: string } | null = null;
  private isRefreshing = false;

  constructor(private readonly logPath: string | null) {}

  getSnapshot(): TokenUsageSnapshot | null {
    if (!this.logPath) {
      return null;
    }
    return {
      totalTokens: this.totalTokens,
      lastUpdatedAt: this.lastUpdatedAt,
      impact: estimateImpact(this.totalTokens),
    };
  }

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async refresh(): Promise<void> {
    if (!this.logPath || this.isRefreshing) {
      return;
    }
    this.isRefreshing = true;
    try {
      const stats = await stat(this.logPath);
      if (stats.size < this.lastOffset) {
        this.resetState();
      }
      const bytesRead = await this.readFromOffset(this.lastOffset);
      this.lastOffset += bytesRead;
      if (bytesRead > 0) {
        this.lastUpdatedAt = new Date().toISOString();
      }
      this.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logWarn("Token usage refresh failed.", { error: message });
    } finally {
      this.isRefreshing = false;
    }
  }

  private resetState(): void {
    this.totalTokens = 0;
    this.lastOffset = 0;
    this.pendingLine = "";
    this.awaitingValue = false;
    this.lastUpdatedAt = null;
  }

  private processLine(line: string): void {
    const trimmed = line.trim();
    if (this.awaitingValue) {
      const count = parseTokenCount(trimmed);
      if (count !== null) {
        this.totalTokens += count;
      }
      this.awaitingValue = false;
      return;
    }
    if (trimmed.toLowerCase() === TOKEN_MARKER) {
      this.awaitingValue = true;
    }
  }

  private async readFromOffset(offset: number): Promise<number> {
    if (!this.logPath) {
      return 0;
    }
    const stream = createReadStream(this.logPath, { start: offset });
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let buffer = this.pendingLine;

    for await (const chunk of stream) {
      bytesRead += chunk.length;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        this.processLine(line);
      }
    }

    buffer += decoder.decode();
    const lines = buffer.split(/\r?\n/);
    this.pendingLine = lines.pop() ?? "";
    for (const line of lines) {
      this.processLine(line);
    }

    return bytesRead;
  }
}
