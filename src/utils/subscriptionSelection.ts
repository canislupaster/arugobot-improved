import { EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";

export type SubscriptionIdResolution =
  | { status: "not_found" }
  | { status: "ambiguous"; matches: string[] }
  | { status: "ok"; id: string };

export type SubscriptionSelection<T> =
  | { status: "none" }
  | { status: "needs_id" }
  | { status: "not_found" }
  | { status: "ambiguous"; matches: string[] }
  | { status: "ok"; subscription: T };

export type SubscriptionSelectionMessages = {
  none: string;
  needsId: string;
  notFound: string;
  ambiguous: (matches: string[]) => string;
};

export function resolveSubscriptionId(
  subscriptions: Array<{ id: string }>,
  inputId: string
): SubscriptionIdResolution {
  const normalized = inputId.toLowerCase();
  const matches = subscriptions.filter((sub) => sub.id.toLowerCase().startsWith(normalized));
  if (matches.length === 0) {
    return { status: "not_found" };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches: matches.map((match) => match.id) };
  }
  return { status: "ok", id: matches[0]!.id };
}

export function selectSubscription<T extends { id: string }>(
  subscriptions: T[],
  inputId: string | null
): SubscriptionSelection<T> {
  if (subscriptions.length === 0) {
    return { status: "none" };
  }
  if (!inputId) {
    if (subscriptions.length > 1) {
      return { status: "needs_id" };
    }
    return { status: "ok", subscription: subscriptions[0]! };
  }
  const resolution = resolveSubscriptionId(subscriptions, inputId);
  if (resolution.status !== "ok") {
    return resolution;
  }
  const subscription =
    subscriptions.find((entry) => entry.id === resolution.id) ?? subscriptions[0]!;
  return { status: "ok", subscription };
}

export async function resolveSubscriptionSelectionOrReply<T extends { id: string }>(
  interaction: ChatInputCommandInteraction,
  subscriptions: T[],
  inputId: string | null,
  messages: SubscriptionSelectionMessages
): Promise<T | null> {
  const selection = selectSubscription(subscriptions, inputId);
  if (selection.status === "none") {
    await interaction.reply({ content: messages.none });
    return null;
  }
  if (selection.status === "needs_id") {
    await interaction.reply({ content: messages.needsId });
    return null;
  }
  if (selection.status === "not_found") {
    await interaction.reply({ content: messages.notFound });
    return null;
  }
  if (selection.status === "ambiguous") {
    await interaction.reply({ content: messages.ambiguous(selection.matches) });
    return null;
  }
  return selection.subscription;
}

export function appendSubscriptionIdField(
  embed: EmbedBuilder,
  subscriptionId: string
): EmbedBuilder {
  embed.addFields({
    name: "Subscription id",
    value: `\`${subscriptionId}\``,
    inline: false,
  });
  return embed;
}
