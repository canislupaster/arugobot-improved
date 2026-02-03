import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import {
  clearSubscriptionsWithNotifications,
  removeSubscriptionWithNotifications,
} from "../../src/utils/subscriptionCleanup.js";

describe("subscriptionCleanup", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("removes contest reminder notifications alongside the subscription", async () => {
    await db
      .insertInto("contest_reminders")
      .values({
        id: "sub-1",
        guild_id: "guild-1",
        channel_id: "channel-1",
        minutes_before: 30,
        role_id: null,
        include_keywords: null,
        exclude_keywords: null,
        scope: "official",
      })
      .execute();
    await db
      .insertInto("contest_reminders")
      .values({
        id: "sub-2",
        guild_id: "guild-1",
        channel_id: "channel-2",
        minutes_before: 60,
        role_id: null,
        include_keywords: null,
        exclude_keywords: null,
        scope: "official",
      })
      .execute();
    await db
      .insertInto("contest_notifications")
      .values({ subscription_id: "sub-1", contest_id: 101 })
      .execute();
    await db
      .insertInto("contest_notifications")
      .values({ subscription_id: "sub-2", contest_id: 202 })
      .execute();

    const removed = await removeSubscriptionWithNotifications(
      db,
      { subscriptions: "contest_reminders", notifications: "contest_notifications" },
      "guild-1",
      "sub-1"
    );

    expect(removed).toBe(true);
    const remainingSubs = await db.selectFrom("contest_reminders").select("id").execute();
    expect(remainingSubs.map((row) => row.id)).toEqual(["sub-2"]);
    const remainingNotifications = await db
      .selectFrom("contest_notifications")
      .select(["subscription_id", "contest_id"])
      .execute();
    expect(remainingNotifications).toEqual([{ subscription_id: "sub-2", contest_id: 202 }]);
  });

  it("clears contest rating alert subscriptions and notifications for a guild", async () => {
    await db
      .insertInto("contest_rating_alert_subscriptions")
      .values({
        id: "alert-1",
        guild_id: "guild-1",
        channel_id: "channel-1",
        role_id: null,
        min_delta: 50,
        include_handles: null,
      })
      .execute();
    await db
      .insertInto("contest_rating_alert_subscriptions")
      .values({
        id: "alert-2",
        guild_id: "guild-1",
        channel_id: "channel-2",
        role_id: null,
        min_delta: 50,
        include_handles: null,
      })
      .execute();
    await db
      .insertInto("contest_rating_alert_subscriptions")
      .values({
        id: "alert-3",
        guild_id: "guild-2",
        channel_id: "channel-3",
        role_id: null,
        min_delta: 50,
        include_handles: null,
      })
      .execute();
    await db
      .insertInto("contest_rating_alert_notifications")
      .values({ subscription_id: "alert-1", contest_id: 99 })
      .execute();
    await db
      .insertInto("contest_rating_alert_notifications")
      .values({ subscription_id: "alert-2", contest_id: 100 })
      .execute();
    await db
      .insertInto("contest_rating_alert_notifications")
      .values({ subscription_id: "alert-3", contest_id: 101 })
      .execute();

    const removedCount = await clearSubscriptionsWithNotifications(
      db,
      {
        subscriptions: "contest_rating_alert_subscriptions",
        notifications: "contest_rating_alert_notifications",
      },
      "guild-1"
    );

    expect(removedCount).toBe(2);
    const remainingSubs = await db
      .selectFrom("contest_rating_alert_subscriptions")
      .select(["id", "guild_id"])
      .execute();
    expect(remainingSubs).toEqual([{ id: "alert-3", guild_id: "guild-2" }]);
    const remainingNotifications = await db
      .selectFrom("contest_rating_alert_notifications")
      .select(["subscription_id", "contest_id"])
      .execute();
    expect(remainingNotifications).toEqual([{ subscription_id: "alert-3", contest_id: 101 }]);
  });
});
