import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import { GuildSettingsService } from "../../src/services/guildSettings.js";

describe("GuildSettingsService", () => {
  it("stores and clears dashboard visibility", async () => {
    const db = createDb(":memory:");
    await migrateToLatest(db);
    const settings = new GuildSettingsService(db);

    expect(await settings.isDashboardPublic("guild-1")).toBe(false);

    await settings.setDashboardPublic("guild-1", true);
    expect(await settings.isDashboardPublic("guild-1")).toBe(true);

    const ids = await settings.listPublicGuildIds();
    expect(ids).toContain("guild-1");

    await settings.clearDashboardSettings("guild-1");
    expect(await settings.isDashboardPublic("guild-1")).toBe(false);

    await db.destroy();
  });
});
