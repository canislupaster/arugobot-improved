import { ChannelType, type Client } from "discord.js";
import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { ContestReminderService } from "../../src/services/contestReminders.js";
import type { ContestService } from "../../src/services/contests.js";

const createMockClient = (send: jest.Mock) =>
  ({
    channels: {
      fetch: jest.fn().mockResolvedValue({
        type: ChannelType.GuildText,
        send,
      }),
    },
  }) as unknown as Client;

describe("ContestReminderService", () => {
  let db: Kysely<Database>;
  let contestService: jest.Mocked<Pick<ContestService, "refresh" | "getUpcomingContests">>;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    contestService = {
      refresh: jest.fn().mockResolvedValue(undefined),
      getUpcomingContests: jest.fn(),
    };
  });

  afterEach(async () => {
    await db.destroy();
    jest.restoreAllMocks();
  });

  it("sends reminders and records notifications", async () => {
    const nowSeconds = 1_700_000_000;
    jest.spyOn(Date, "now").mockReturnValue(nowSeconds * 1000);
    contestService.getUpcomingContests.mockReturnValue([
      {
        id: 101,
        name: "CF Round",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 10 * 60,
        durationSeconds: 7200,
      },
      {
        id: 102,
        name: "Later Round",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 2 * 60 * 60,
        durationSeconds: 7200,
      },
    ]);

    const service = new ContestReminderService(db, contestService);
    await service.setSubscription("guild-1", "channel-1", 15, "role-1", [], []);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    await service.runTick(client);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "<@&role-1>",
        allowedMentions: { roles: ["role-1"] },
      })
    );
    const notifications = await db.selectFrom("contest_notifications").selectAll().execute();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.contest_id).toBe(101);
  });

  it("skips contests already notified", async () => {
    const nowSeconds = 1_700_000_000;
    jest.spyOn(Date, "now").mockReturnValue(nowSeconds * 1000);
    contestService.getUpcomingContests.mockReturnValue([
      {
        id: 201,
        name: "CF Round",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 5 * 60,
        durationSeconds: 7200,
      },
    ]);

    await db
      .insertInto("contest_notifications")
      .values({ guild_id: "guild-1", contest_id: 201, notified_at: new Date().toISOString() })
      .execute();

    const service = new ContestReminderService(db, contestService);
    await service.setSubscription("guild-1", "channel-1", 10, null, [], []);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    await service.runTick(client);

    expect(send).not.toHaveBeenCalled();
  });

  it("filters contests using include/exclude keywords", async () => {
    const nowSeconds = 1_700_000_000;
    jest.spyOn(Date, "now").mockReturnValue(nowSeconds * 1000);
    contestService.getUpcomingContests.mockReturnValue([
      {
        id: 401,
        name: "Codeforces Round #900 (Div. 2)",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 5 * 60,
        durationSeconds: 7200,
      },
      {
        id: 402,
        name: "Kotlin Heroes: Practice",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 5 * 60,
        durationSeconds: 7200,
      },
    ]);

    const service = new ContestReminderService(db, contestService);
    await service.setSubscription("guild-1", "channel-1", 10, null, ["div. 2"], ["kotlin"]);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    await service.runTick(client);

    expect(send).toHaveBeenCalledTimes(1);
    const notifications = await db.selectFrom("contest_notifications").selectAll().execute();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.contest_id).toBe(401);
  });

  it("skips refresh when there are no subscriptions", async () => {
    const service = new ContestReminderService(db, contestService);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    await service.runTick(client);

    expect(contestService.refresh).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("captures refresh failures", async () => {
    contestService.refresh.mockRejectedValue(new Error("CF down"));
    contestService.getUpcomingContests.mockReturnValue([]);

    const service = new ContestReminderService(db, contestService);
    await service.setSubscription("guild-1", "channel-1", 10, null, [], []);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    await service.runTick(client);

    expect(service.getLastError()?.message).toBe("CF down");
    expect(send).not.toHaveBeenCalled();
  });

  it("uses cached contests when refresh fails", async () => {
    const nowSeconds = 1_700_000_000;
    jest.spyOn(Date, "now").mockReturnValue(nowSeconds * 1000);
    contestService.refresh.mockRejectedValue(new Error("CF down"));
    contestService.getUpcomingContests.mockReturnValue([
      {
        id: 301,
        name: "Cached Round",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 10 * 60,
        durationSeconds: 7200,
      },
    ]);

    const service = new ContestReminderService(db, contestService);
    await service.setSubscription("guild-1", "channel-1", 15, null, [], []);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    await service.runTick(client);

    expect(send).toHaveBeenCalledTimes(1);
    expect(service.getLastError()?.message).toBe("CF down");
  });

  it("avoids overlapping ticks", async () => {
    let resolveRefresh: () => void = () => undefined;
    contestService.refresh.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    contestService.getUpcomingContests.mockReturnValue([]);

    const service = new ContestReminderService(db, contestService);
    await service.setSubscription("guild-1", "channel-1", 10, null, [], []);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    const first = service.runTick(client);
    const second = service.runTick(client);

    await new Promise((resolve) => setImmediate(resolve));
    expect(contestService.refresh).toHaveBeenCalledTimes(1);

    resolveRefresh();
    await Promise.all([first, second]);
  });
});
