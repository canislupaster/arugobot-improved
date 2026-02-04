import type { Client } from "discord.js";

import type { SendableChannelStatus } from "../../src/utils/discordChannels.js";
import { getSendableChannelStatuses } from "../../src/utils/discordChannels.js";
import {
  buildChannelSubscriptionEntries,
  filterChannelSubscriptionEntries,
  resolveSubscriptionEntriesOrReply,
  resolveSubscriptionEntriesFromService,
  type ChannelSubscriptionEntry,
} from "../../src/utils/subscriptionStatus.js";

jest.mock("../../src/utils/discordChannels.js", () => {
  const actual = jest.requireActual("../../src/utils/discordChannels.js");
  return {
    ...actual,
    getSendableChannelStatuses: jest.fn(),
  };
});

const mockGetSendableChannelStatuses = getSendableChannelStatuses as jest.MockedFunction<
  typeof getSendableChannelStatuses
>;

describe("buildChannelSubscriptionEntries", () => {
  it("builds entries with channel statuses and last notified times", async () => {
    const okStatus: SendableChannelStatus = { status: "ok", channel: {} as never };
    const statuses: SendableChannelStatus[] = [okStatus, { status: "missing", channelId: "channel-2" }];
    mockGetSendableChannelStatuses.mockResolvedValue(statuses);

    const subscriptions = [
      { id: "sub-1", channelId: "channel-1" },
      { id: "sub-2", channelId: "channel-2" },
    ];
    const lastNotifiedMap = new Map<string, string | null>([["sub-1", "2026-02-03T00:00:00Z"]]);

    const entries = await buildChannelSubscriptionEntries(
      {} as Client,
      subscriptions,
      lastNotifiedMap
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.subscription.id).toBe("sub-1");
    expect(entries[0]?.lastNotifiedAt).toBe("2026-02-03T00:00:00Z");
    expect(entries[0]?.channelStatus).toEqual(statuses[0]);
    expect(entries[1]?.lastNotifiedAt).toBeNull();
    expect(entries[1]?.channelStatus).toEqual(statuses[1]);
  });
});

describe("filterChannelSubscriptionEntries", () => {
  it("filters to non-ok channel statuses when onlyIssues is true", () => {
    const okStatus: SendableChannelStatus = { status: "ok", channel: {} as never };
    const entries: Array<ChannelSubscriptionEntry<{ id: string; channelId: string }>> = [
      {
        subscription: { id: "sub-1", channelId: "channel-1" },
        channelStatus: okStatus,
        lastNotifiedAt: null,
      },
      {
        subscription: { id: "sub-2", channelId: "channel-2" },
        channelStatus: { status: "missing", channelId: "channel-2" },
        lastNotifiedAt: null,
      },
    ];

    const filtered = filterChannelSubscriptionEntries(entries, true);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.subscription.id).toBe("sub-2");
  });
});

describe("resolveSubscriptionEntriesOrReply", () => {
  it("replies when no subscriptions exist", async () => {
    const interaction = { reply: jest.fn().mockResolvedValue(undefined) };

    const result = await resolveSubscriptionEntriesOrReply(
      interaction,
      {} as Client,
      [],
      new Map(),
      false,
      { noSubscriptions: "No subs.", noIssues: "No issues." }
    );

    expect(result.status).toBe("replied");
    expect(interaction.reply).toHaveBeenCalledWith({ content: "No subs." });
  });

  it("replies with no-issues message when onlyIssues filters everything", async () => {
    const okStatus: SendableChannelStatus = { status: "ok", channel: {} as never };
    mockGetSendableChannelStatuses.mockResolvedValue([okStatus]);
    const interaction = { reply: jest.fn().mockResolvedValue(undefined) };
    const subscriptions = [{ id: "sub-1", channelId: "channel-1" }];

    const result = await resolveSubscriptionEntriesOrReply(
      interaction,
      {} as Client,
      subscriptions,
      new Map(),
      true,
      { noSubscriptions: "No subs.", noIssues: "No issues." }
    );

    expect(result.status).toBe("replied");
    expect(interaction.reply).toHaveBeenCalledWith({ content: "No issues." });
  });

  it("returns entries when available", async () => {
    const okStatus: SendableChannelStatus = { status: "ok", channel: {} as never };
    mockGetSendableChannelStatuses.mockResolvedValue([okStatus]);
    const interaction = { reply: jest.fn().mockResolvedValue(undefined) };
    const subscriptions = [{ id: "sub-1", channelId: "channel-1" }];

    const result = await resolveSubscriptionEntriesOrReply(
      interaction,
      {} as Client,
      subscriptions,
      new Map([["sub-1", "2026-02-03T00:00:00Z"]]),
      false,
      { noSubscriptions: "No subs.", noIssues: "No issues." }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.subscription.id).toBe("sub-1");
      expect(result.entries[0]?.lastNotifiedAt).toBe("2026-02-03T00:00:00Z");
    }
  });
});

describe("resolveSubscriptionEntriesFromService", () => {
  it("replies when the service returns no subscriptions", async () => {
    const interaction = { reply: jest.fn().mockResolvedValue(undefined) };

    const result = await resolveSubscriptionEntriesFromService(
      interaction,
      {} as Client,
      async () => [],
      async () => new Map(),
      false,
      { noSubscriptions: "No subs.", noIssues: "No issues." }
    );

    expect(result.status).toBe("replied");
    expect(interaction.reply).toHaveBeenCalledWith({ content: "No subs." });
  });

  it("returns subscriptions and entries when available", async () => {
    const okStatus: SendableChannelStatus = { status: "ok", channel: {} as never };
    mockGetSendableChannelStatuses.mockResolvedValue([okStatus]);
    const interaction = { reply: jest.fn().mockResolvedValue(undefined) };
    const subscriptions = [{ id: "sub-1", channelId: "channel-1" }];

    const result = await resolveSubscriptionEntriesFromService(
      interaction,
      {} as Client,
      async () => subscriptions,
      async () => new Map([["sub-1", "2026-02-03T00:00:00Z"]]),
      false,
      { noSubscriptions: "No subs.", noIssues: "No issues." }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.subscriptions).toEqual(subscriptions);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.subscription.id).toBe("sub-1");
      expect(result.entries[0]?.lastNotifiedAt).toBe("2026-02-03T00:00:00Z");
    }
  });
});
