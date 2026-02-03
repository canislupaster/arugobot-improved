import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import { ContestFilterService } from "../../src/services/contestFilters.js";

describe("ContestFilterService", () => {
  it("stores and clears default filters", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const service = new ContestFilterService(db);

    expect(await service.getSettings("guild-1")).toBeNull();

    await service.setSettings("guild-1", {
      includeKeywords: "div. 2",
      excludeKeywords: "kotlin",
      scope: "gym",
    });

    const settings = await service.getSettings("guild-1");
    expect(settings?.includeKeywords).toBe("div. 2");
    expect(settings?.excludeKeywords).toBe("kotlin");
    expect(settings?.scope).toBe("gym");

    await service.clearSettings("guild-1");
    expect(await service.getSettings("guild-1")).toBeNull();

    await db.destroy();
  });
});
