import { EmbedBuilder, type Client } from "discord.js";

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

type SubscriptionEntriesResult<TSubscription> =
  | { status: "ok"; entries: Array<ChannelSubscriptionEntry<TSubscription>> }
  | { status: "replied" };

export type SubscriptionListResult<TSubscription> =
  | {
      status: "ok";
      entries: Array<ChannelSubscriptionEntry<TSubscription>>;
      subscriptions: TSubscription[];
    }
  | { status: "replied" };

export async function resolveSubscriptionEntriesOrReply<
  TSubscription extends { id: string; channelId: string },
>(
  interaction: { reply: (options: { content: string }) => Promise<unknown> },
  client: Client,
  subscriptions: TSubscription[],
  lastNotifiedMap: Map<string, string | null>,
  onlyIssues: boolean,
  messages: { noSubscriptions: string; noIssues: string }
): Promise<SubscriptionEntriesResult<TSubscription>> {
  if (subscriptions.length === 0) {
    await interaction.reply({ content: messages.noSubscriptions });
    return { status: "replied" };
  }

  const entries = await buildChannelSubscriptionEntries(
    client,
    subscriptions,
    lastNotifiedMap
  );
  const filtered = filterChannelSubscriptionEntries(entries, onlyIssues);
  if (filtered.length === 0) {
    await interaction.reply({
      content: onlyIssues ? messages.noIssues : messages.noSubscriptions,
    });
    return { status: "replied" };
  }

  return { status: "ok", entries: filtered };
}

export async function resolveSubscriptionEntriesFromService<
  TSubscription extends { id: string; channelId: string },
>(
  interaction: { reply: (options: { content: string }) => Promise<unknown> },
  client: Client,
  listSubscriptions: () => Promise<TSubscription[]>,
  getLastNotificationMap: (ids: string[]) => Promise<Map<string, string | null>>,
  onlyIssues: boolean,
  messages: { noSubscriptions: string; noIssues: string }
): Promise<SubscriptionListResult<TSubscription>> {
  const subscriptions = await listSubscriptions();
  if (subscriptions.length === 0) {
    await interaction.reply({ content: messages.noSubscriptions });
    return { status: "replied" };
  }
  const lastNotifiedMap = await getLastNotificationMap(
    subscriptions.map((subscription) => subscription.id)
  );
  const entryResult = await resolveSubscriptionEntriesOrReply(
    interaction,
    client,
    subscriptions,
    lastNotifiedMap,
    onlyIssues,
    messages
  );
  if (entryResult.status === "replied") {
    return entryResult;
  }
  return { status: "ok", entries: entryResult.entries, subscriptions };
}

export function buildSubscriptionListEmbed<TSubscription>(params: {
  title: string;
  color: number;
  entries: Array<ChannelSubscriptionEntry<TSubscription>>;
  formatEntry: (entry: ChannelSubscriptionEntry<TSubscription>) => string;
}): EmbedBuilder {
  return new EmbedBuilder().setTitle(params.title).setColor(params.color).addFields(
    params.entries.map((entry, index) => ({
      name: `Subscription ${index + 1}`,
      value: params.formatEntry(entry),
      inline: false,
    }))
  );
}
