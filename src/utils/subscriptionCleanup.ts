import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";

type SubscriptionTable =
  | "contest_reminders"
  | "contest_rating_alert_subscriptions";

type NotificationTable =
  | "contest_notifications"
  | "contest_rating_alert_notifications";

type CleanupTables = {
  subscriptions: SubscriptionTable;
  notifications: NotificationTable;
};

export async function removeSubscriptionWithNotifications(
  db: Kysely<Database>,
  tables: CleanupTables,
  guildId: string,
  subscriptionId: string
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .deleteFrom(tables.subscriptions)
      .where("guild_id", "=", guildId)
      .where("id", "=", subscriptionId)
      .executeTakeFirst();
    const removed = Number(result.numDeletedRows ?? 0) > 0;
    if (removed) {
      await trx
        .deleteFrom(tables.notifications)
        .where("subscription_id", "=", subscriptionId)
        .execute();
    }
    return removed;
  });
}

export async function clearSubscriptionsWithNotifications(
  db: Kysely<Database>,
  tables: CleanupTables,
  guildId: string
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const subscriptions = await trx
      .selectFrom(tables.subscriptions)
      .select("id")
      .where("guild_id", "=", guildId)
      .execute();
    if (subscriptions.length === 0) {
      return 0;
    }
    const ids = subscriptions.map((subscription) => subscription.id);
    await trx
      .deleteFrom(tables.notifications)
      .where("subscription_id", "in", ids)
      .execute();
    const result = await trx
      .deleteFrom(tables.subscriptions)
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  });
}

export async function getLastNotificationMap(
  db: Kysely<Database>,
  table: NotificationTable,
  subscriptionIds: string[]
): Promise<Map<string, string>> {
  if (subscriptionIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectFrom(table)
    .select(({ fn }) => [
      "subscription_id",
      fn.max<string>("notified_at").as("last_notified_at"),
    ])
    .where("subscription_id", "in", subscriptionIds)
    .groupBy("subscription_id")
    .execute();
  return new Map(
    rows
      .filter((row) => Boolean(row.last_notified_at))
      .map((row) => [row.subscription_id, row.last_notified_at!])
  );
}
