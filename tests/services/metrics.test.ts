import {
  getCommandCount,
  getCommandUsageSummary,
  getLastCommandAt,
  getUniqueCommandCount,
  recordCommandResult,
  resetCommandMetrics,
} from "../../src/services/metrics.js";

describe("metrics", () => {
  beforeEach(() => {
    resetCommandMetrics();
  });

  it("tracks command counts and latency", () => {
    recordCommandResult("ping", 120, true);
    recordCommandResult("ping", 80, false);
    recordCommandResult("help", 50, true);

    expect(getCommandCount()).toBe(3);
    expect(getUniqueCommandCount()).toBe(2);
    expect(getLastCommandAt()).toEqual(expect.any(String));

    const summary = getCommandUsageSummary(2);
    expect(summary[0]?.name).toBe("ping");
    expect(summary[0]?.count).toBe(2);
    expect(summary[0]?.successRate).toBe(50);
    expect(summary[0]?.avgLatencyMs).toBe(100);
    expect(summary[0]?.maxLatencyMs).toBe(120);
  });
});
