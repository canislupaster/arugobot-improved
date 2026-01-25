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
});
