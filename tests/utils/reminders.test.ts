import { ChannelType, type Client } from "discord.js";

import {
  getManualSendFailure,
  recordReminderSendFailure,
  resolveManualSendChannel,
} from "../../src/utils/reminders.js";

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

describe("getManualSendFailure", () => {
  it("returns already_sent payload", () => {
    const result = getManualSendFailure({
      status: "already_sent",
      lastSentAt: "2024-01-01T00:00:00.000Z",
    });

    expect(result).toEqual({ status: "already_sent", lastSentAt: "2024-01-01T00:00:00.000Z" });
  });

  it("returns channel_missing payload", () => {
    const result = getManualSendFailure({
      status: "channel_missing",
      channelId: "channel-2",
    });

    expect(result).toEqual({ status: "channel_missing", channelId: "channel-2" });
  });
});

describe("recordReminderSendFailure", () => {
  it("records and logs the error message", () => {
    const record = jest.fn();
    const log = jest.fn();

    const message = recordReminderSendFailure({
      error: new Error("boom"),
      record,
      log,
      logMessage: "Manual reminder failed.",
      logContext: { guildId: "guild-1", channelId: "channel-1" },
    });

    expect(message).toBe("boom");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom", timestamp: expect.any(String) })
    );
    expect(log).toHaveBeenCalledWith(
      "Manual reminder failed.",
      expect.objectContaining({
        guildId: "guild-1",
        channelId: "channel-1",
        error: "boom",
      })
    );
  });
});
