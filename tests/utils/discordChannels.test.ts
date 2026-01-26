import { ChannelType, type Client } from "discord.js";

import {
  resolveSendableChannel,
  resolveSendableChannelOrWarn,
} from "../../src/utils/discordChannels.js";
import * as logger from "../../src/utils/logger.js";

describe("resolveSendableChannel", () => {
  it("returns a sendable channel when the channel is guild text", async () => {
    const channel = { type: ChannelType.GuildText };
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;

    const result = await resolveSendableChannel(client, "channel-1");

    expect(result).toBe(channel);
  });

  it("returns null when the fetch fails", async () => {
    const client = {
      channels: {
        fetch: jest.fn().mockRejectedValue(new Error("missing")),
      },
    } as unknown as Client;

    const result = await resolveSendableChannel(client, "channel-1");

    expect(result).toBeNull();
  });

  it("logs a warning when a sendable channel is missing", async () => {
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as unknown as Client;
    const logWarn = jest.spyOn(logger, "logWarn").mockImplementation(() => {});

    const result = await resolveSendableChannelOrWarn(client, "channel-2", "Missing channel", {
      guildId: "guild-1",
    });

    expect(result).toBeNull();
    expect(logWarn).toHaveBeenCalledWith("Missing channel", {
      guildId: "guild-1",
      channelId: "channel-2",
    });
    logWarn.mockRestore();
  });
});
