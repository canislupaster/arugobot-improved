import type { Client } from "discord.js";

import type { SendableChannelStatus } from "./discordChannels.js";
import { getSendableChannelStatuses } from "./discordChannels.js";

export type ChannelSubscriptionEntry<TSubscription> = {
  subscription: TSubscription;
  channelStatus: SendableChannelStatus | null;
  lastNotifiedAt: string | null;
};

export async function buildChannelSubscriptionEntries<
  TSubscription extends { id: string; channelId: string },
>(
  client: Client,
  subscriptions: TSubscription[],
  lastNotifiedMap: Map<string, string | null>
): Promise<Array<ChannelSubscriptionEntry<TSubscription>>> {
  if (subscriptions.length === 0) {
    return [];
  }
  const statuses = await getSendableChannelStatuses(
    client,
    subscriptions.map((subscription) => subscription.channelId)
  );
  return subscriptions.map((subscription, index) => ({
    subscription,
    channelStatus: statuses[index] ?? null,
    lastNotifiedAt: lastNotifiedMap.get(subscription.id) ?? null,
  }));
}

export function filterChannelSubscriptionEntries<TSubscription>(
  entries: Array<ChannelSubscriptionEntry<TSubscription>>,
  onlyIssues: boolean
): Array<ChannelSubscriptionEntry<TSubscription>> {
  if (!onlyIssues) {
    return entries;
  }
  return entries.filter((entry) => entry.channelStatus?.status !== "ok");
}
