import { ChannelType, type Client } from "discord.js";
import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { ContestRatingAlertService } from "../../src/services/contestRatingAlerts.js";
import type { ContestRatingChangesService } from "../../src/services/contestRatingChanges.js";
import type { ContestService } from "../../src/services/contests.js";
import type { StoreService } from "../../src/services/store.js";

const createMockClient = (send: jest.Mock) =>
  ({
    channels: {
      fetch: jest.fn().mockResolvedValue({
        type: ChannelType.GuildText,
        send,
      }),
    },
  }) as unknown as Client;

const createMissingChannelClient = () =>
  ({
    channels: {
      fetch: jest.fn().mockResolvedValue(null),
    },
  }) as unknown as Client;

describe("ContestRatingAlertService", () => {
  let db: Kysely<Database>;
  let contestService: jest.Mocked<Pick<ContestService, "refresh" | "getFinished">>;
  let ratingChanges: jest.Mocked<Pick<ContestRatingChangesService, "getContestRatingChanges">>;
  let store: jest.Mocked<Pick<StoreService, "getLinkedUsers">>;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    contestService = {
      refresh: jest.fn().mockResolvedValue(undefined),
      getFinished: jest.fn(),
    };
    ratingChanges = {
      getContestRatingChanges: jest.fn(),
    };
    store = {
      getLinkedUsers: jest.fn(),
    };
  });

  afterEach(async () => {
    await db.destroy();
    jest.restoreAllMocks();
  });

  it("sends alerts and records notifications", async () => {
    contestService.getFinished.mockReturnValue([
      {
        id: 101,
        name: "CF Round",
        phase: "FINISHED",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
      },
    ]);
    ratingChanges.getContestRatingChanges.mockResolvedValue({
      changes: [
        {
          handle: "tourist",
          contestId: 101,
          contestName: "CF Round",
          rank: 10,
          oldRating: 2000,
          newRating: 2100,
          ratingUpdateTimeSeconds: 1_700_000_100,
        },
      ],
      source: "api",
      isStale: false,
    });
    store.getLinkedUsers.mockResolvedValue([{ userId: "user-1", handle: "tourist" }]);

    const service = new ContestRatingAlertService(db, contestService, ratingChanges, store);
    const subscription = await service.createSubscription("guild-1", "channel-1", "role-1");
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
    const notifications = await db
      .selectFrom("contest_rating_alert_notifications")
      .selectAll()
      .execute();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.contest_id).toBe(101);
    expect(notifications[0]?.subscription_id).toBe(subscription.id);
  });

  it("skips contests already notified", async () => {
    contestService.getFinished.mockReturnValue([
      {
        id: 201,
        name: "CF Round",
        phase: "FINISHED",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
      },
    ]);
    ratingChanges.getContestRatingChanges.mockResolvedValue({
      changes: [
        {
          handle: "tourist",
          contestId: 201,
          contestName: "CF Round",
          rank: 12,
          oldRating: 2000,
          newRating: 2100,
          ratingUpdateTimeSeconds: 1_700_000_100,
        },
      ],
      source: "api",
      isStale: false,
    });
    store.getLinkedUsers.mockResolvedValue([{ userId: "user-1", handle: "tourist" }]);

    const service = new ContestRatingAlertService(db, contestService, ratingChanges, store);
    const subscription = await service.createSubscription("guild-1", "channel-1", null);

    await db
      .insertInto("contest_rating_alert_notifications")
      .values({
        subscription_id: subscription.id,
        contest_id: 201,
        notified_at: new Date().toISOString(),
      })
      .execute();
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    await service.runTick(client);

    expect(send).not.toHaveBeenCalled();
  });

  it("filters entries below the minimum delta", async () => {
    contestService.getFinished.mockReturnValue([
      {
        id: 301,
        name: "CF Round",
        phase: "FINISHED",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
      },
    ]);
    ratingChanges.getContestRatingChanges.mockResolvedValue({
      changes: [
        {
          handle: "tourist",
          contestId: 301,
          contestName: "CF Round",
          rank: 10,
          oldRating: 2000,
          newRating: 2075,
          ratingUpdateTimeSeconds: 1_700_000_100,
        },
      ],
      source: "api",
      isStale: false,
    });
    store.getLinkedUsers.mockResolvedValue([{ userId: "user-1", handle: "tourist" }]);

    const service = new ContestRatingAlertService(db, contestService, ratingChanges, store);
    const subscription = await service.createSubscription("guild-1", "channel-1", null, {
      minDelta: 100,
    });

    const preview = await service.getPreview(subscription);

    expect(preview.status).toBe("no_changes");
  });

  it("returns no_matching_handles when filters exclude all linked users", async () => {
    contestService.getFinished.mockReturnValue([
      {
        id: 401,
        name: "CF Round",
        phase: "FINISHED",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
      },
    ]);
    ratingChanges.getContestRatingChanges.mockResolvedValue({
      changes: [
        {
          handle: "tourist",
          contestId: 401,
          contestName: "CF Round",
          rank: 10,
          oldRating: 2000,
          newRating: 2100,
          ratingUpdateTimeSeconds: 1_700_000_100,
        },
      ],
      source: "api",
      isStale: false,
    });
    store.getLinkedUsers.mockResolvedValue([{ userId: "user-1", handle: "tourist" }]);

    const service = new ContestRatingAlertService(db, contestService, ratingChanges, store);
    const subscription = await service.createSubscription("guild-1", "channel-1", null, {
      includeHandles: ["benq"],
    });

    const preview = await service.getPreview(subscription);

    expect(preview.status).toBe("no_matching_handles");
  });

  it("returns channel_missing when the manual alert channel is unavailable", async () => {
    const service = new ContestRatingAlertService(db, contestService, ratingChanges, store);
    const subscription = await service.createSubscription(
      "guild-1",
      "missing-channel",
      null
    );
    const client = createMissingChannelClient();

    const result = await service.sendManualAlert(subscription, client, false);

    expect(result).toEqual({ status: "channel_missing", channelId: "missing-channel" });
    expect(contestService.refresh).not.toHaveBeenCalled();
  });

  it("returns channel_missing_permissions when the manual alert channel lacks permissions", async () => {
    const service = new ContestRatingAlertService(db, contestService, ratingChanges, store);
    const subscription = await service.createSubscription("guild-1", "channel-1", null);
    const client = {
      user: { id: "bot-1" },
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: ChannelType.GuildText,
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(false),
          }),
        }),
      },
    } as unknown as Client;

    const result = await service.sendManualAlert(subscription, client, false);

    expect(result).toEqual({
      status: "channel_missing_permissions",
      channelId: "channel-1",
      missingPermissions: ["ViewChannel", "SendMessages"],
    });
    expect(contestService.refresh).not.toHaveBeenCalled();
  });

  it("returns error when manual sending fails", async () => {
    contestService.getFinished.mockReturnValue([
      {
        id: 501,
        name: "CF Round",
        phase: "FINISHED",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
      },
    ]);
    ratingChanges.getContestRatingChanges.mockResolvedValue({
      changes: [
        {
          handle: "tourist",
          contestId: 501,
          contestName: "CF Round",
          rank: 10,
          oldRating: 2000,
          newRating: 2100,
          ratingUpdateTimeSeconds: 1_700_000_100,
        },
      ],
      source: "api",
      isStale: false,
    });
    store.getLinkedUsers.mockResolvedValue([{ userId: "user-1", handle: "tourist" }]);

    const service = new ContestRatingAlertService(db, contestService, ratingChanges, store);
    const subscription = await service.createSubscription("guild-1", "channel-1", null);
    const send = jest.fn().mockRejectedValue(new Error("boom"));
    const client = createMockClient(send);

    const result = await service.sendManualAlert(subscription, client, false);

    expect(result).toEqual({ status: "error", message: "boom" });
    expect(service.getLastError()?.message).toBe("boom");
    const notifications = await db
      .selectFrom("contest_rating_alert_notifications")
      .selectAll()
      .execute();
    expect(notifications).toHaveLength(0);
  });

  it("lists subscriptions with normalized handle filters", async () => {
    const service = new ContestRatingAlertService(db, contestService, ratingChanges, store);
    await service.createSubscription("guild-1", "channel-1", null, {
      minDelta: 50,
      includeHandles: ["Tourist", "tourist", "Petr"],
    });
    await service.createSubscription("guild-2", "channel-2", null);

    const subscriptions = await service.listSubscriptions("guild-1");

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toEqual(
      expect.objectContaining({
        guildId: "guild-1",
        channelId: "channel-1",
        minDelta: 50,
        includeHandles: ["tourist", "petr"],
      })
    );
  });
});
