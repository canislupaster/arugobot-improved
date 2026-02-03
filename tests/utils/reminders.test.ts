import { ChannelType, type Client } from "discord.js";

import { resolveManualSendChannel } from "../../src/utils/reminders.js";

describe("resolveManualSendChannel", () => {
  it("returns already_sent when a reminder was sent in the period", async () => {
    const client = {
      channels: {
        fetch: jest.fn(),
      },
    } as unknown as Client;
    const lastSentAt = new Date().toISOString();

    const result = await resolveManualSendChannel(client, {
      channelId: "channel-1",
      lastSentAt,
      force: false,
      periodStartMs: Date.now() - 1000,
    });

    expect(result).toEqual({ status: "already_sent", lastSentAt });
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it("returns channel_missing when the channel is not sendable", async () => {
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as unknown as Client;

    const result = await resolveManualSendChannel(client, {
      channelId: "channel-2",
      lastSentAt: null,
      force: true,
      periodStartMs: Date.now(),
    });

    expect(result).toEqual({ status: "channel_missing", channelId: "channel-2" });
  });

  it("returns ready with the resolved channel", async () => {
    const channel = { id: "channel-3", type: ChannelType.GuildText };
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;

    const result = await resolveManualSendChannel(client, {
      channelId: "channel-3",
      lastSentAt: null,
      force: true,
      periodStartMs: Date.now(),
    });

    expect(result).toEqual({ status: "ready", channel });
  });
});
