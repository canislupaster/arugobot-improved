import { randomUUID } from "node:crypto";
import { appendFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { TokenUsageService } from "../../src/services/tokenUsage.js";

describe("TokenUsageService", () => {
  const logPath = path.join(tmpdir(), `token-usage-${randomUUID()}.log`);

  afterEach(async () => {
    await rm(logPath, { force: true });
  });

  it("aggregates token counts across refreshes", async () => {
    await writeFile(logPath, "header\n\ntokens used\n1,250\n");
    const service = new TokenUsageService(logPath);

    await service.refresh();

    const first = service.getSnapshot();
    expect(first?.totalTokens).toBe(1250);

    await appendFile(logPath, "noise\n\ntokens used\n500\n");
    await service.refresh();

    const second = service.getSnapshot();
    expect(second?.totalTokens).toBe(1750);
  });
});
