import { ChannelType, type Channel, type Client, type NewsChannel, type TextChannel } from "discord.js";

export type SendableChannel = TextChannel | NewsChannel;

export function isSendableChannel(channel: Channel | null): channel is SendableChannel {
  return (
    !!channel &&
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
  );
}

export async function resolveSendableChannel(
  client: Client,
  channelId: string
): Promise<SendableChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return isSendableChannel(channel) ? channel : null;
}
