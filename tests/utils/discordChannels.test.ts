import { ChannelType, type Client } from "discord.js";

import { resolveSendableChannel } from "../../src/utils/discordChannels.js";

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
});
