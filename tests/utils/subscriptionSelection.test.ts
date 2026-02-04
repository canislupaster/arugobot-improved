import { EmbedBuilder } from "discord.js";

import {
  appendSubscriptionIdField,
  resolveSubscriptionId,
  resolveSubscriptionSelectionOrReply,
  selectSubscription,
} from "../../src/utils/subscriptionSelection.js";

const selectionMessages = {
  none: "none",
  needsId: "needs_id",
  notFound: "not_found",
  ambiguous: (matches: string[]) => `ambiguous:${matches.join(",")}`,
};

describe("subscriptionSelection", () => {
  const subscriptions = [{ id: "abc123" }, { id: "abd456" }];

  test("resolveSubscriptionId returns not_found", () => {
    expect(resolveSubscriptionId(subscriptions, "zzz")).toEqual({ status: "not_found" });
  });

  test("resolveSubscriptionId returns ambiguous for prefix matches", () => {
    expect(resolveSubscriptionId(subscriptions, "ab")).toEqual({
      status: "ambiguous",
      matches: ["abc123", "abd456"],
    });
  });

  test("resolveSubscriptionId returns ok for single match", () => {
    expect(resolveSubscriptionId(subscriptions, "abc")).toEqual({
      status: "ok",
      id: "abc123",
    });
  });

  test("selectSubscription handles empty and needs_id cases", () => {
    expect(selectSubscription([], null)).toEqual({ status: "none" });
    expect(selectSubscription(subscriptions, null)).toEqual({ status: "needs_id" });
  });

  test("selectSubscription returns subscription when resolved", () => {
    const single = [{ id: "only" }];
    expect(selectSubscription(single, null)).toEqual({ status: "ok", subscription: single[0] });
    expect(selectSubscription(subscriptions, "abd")).toEqual({
      status: "ok",
      subscription: subscriptions[1],
    });
  });

  test("resolveSubscriptionSelectionOrReply replies on none", async () => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const interaction = { reply } as unknown as { reply: typeof reply };
    const result = await resolveSubscriptionSelectionOrReply(
      interaction as never,
      [],
      null,
      selectionMessages
    );
    expect(result).toBeNull();
    expect(reply).toHaveBeenCalledWith({ content: "none" });
  });

  test("resolveSubscriptionSelectionOrReply returns subscription on ok", async () => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const interaction = { reply } as unknown as { reply: typeof reply };
    const result = await resolveSubscriptionSelectionOrReply(
      interaction as never,
      subscriptions,
      "abc",
      selectionMessages
    );
    expect(result).toEqual(subscriptions[0]);
    expect(reply).not.toHaveBeenCalled();
  });

  test("appendSubscriptionIdField adds a subscription id field", () => {
    const embed = new EmbedBuilder().setTitle("Test");
    appendSubscriptionIdField(embed, "sub-123");
    const fields = embed.data.fields ?? [];
    expect(fields).toHaveLength(1);
    expect(fields[0]).toEqual({
      name: "Subscription id",
      value: "`sub-123`",
      inline: false,
    });
  });
});
