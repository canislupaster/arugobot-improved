import {
  ChannelType,
  PermissionFlagsBits,
  type Channel,
  type Client,
  type NewsChannel,
  type TextChannel,
} from "discord.js";

import { logWarn, type LogContext } from "./logger.js";

export type SendableChannel = TextChannel | NewsChannel;

const REQUIRED_SEND_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, name: "ViewChannel" },
  { flag: PermissionFlagsBits.SendMessages, name: "SendMessages" },
];
const DEFAULT_WARNING_SUPPRESS_MS = 60 * 60 * 1000;
const warningCache = new Map<string, number>();

export function isSendableChannel(channel: Channel | null): channel is SendableChannel {
  return (
    !!channel &&
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
  );
}

function getMissingSendPermissions(channel: SendableChannel, client: Client): string[] | null {
  if (!client.user || typeof channel.permissionsFor !== "function") {
    return null;
  }
  const permissions = channel.permissionsFor(client.user);
  if (!permissions) {
    return REQUIRED_SEND_PERMISSIONS.map((permission) => permission.name);
  }
  const missing = REQUIRED_SEND_PERMISSIONS.filter(
    (permission) => !permissions.has(permission.flag)
  ).map((permission) => permission.name);
  return missing.length > 0 ? missing : null;
}

async function fetchSendableChannel(
  client: Client,
  channelId: string
): Promise<SendableChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return isSendableChannel(channel) ? channel : null;
}

export async function resolveSendableChannel(
  client: Client,
  channelId: string
): Promise<SendableChannel | null> {
  const channel = await fetchSendableChannel(client, channelId);
  if (!channel) {
    return null;
  }
  const missingPermissions = getMissingSendPermissions(channel, client);
  return missingPermissions ? null : channel;
}

export async function resolveSendableChannelOrWarn(
  client: Client,
  channelId: string,
  message: string,
  context: LogContext = {}
): Promise<SendableChannel | null> {
  const channel = await fetchSendableChannel(client, channelId);
  if (!channel) {
    logChannelWarning(message, channelId, { ...context, channelId });
    return null;
  }
  const missingPermissions = getMissingSendPermissions(channel, client);
  if (missingPermissions) {
    logChannelWarning(message, channelId, { ...context, channelId, missingPermissions });
    return null;
  }
  return channel;
}

export function resetChannelWarningCache(): void {
  warningCache.clear();
}

function logChannelWarning(message: string, channelId: string, context: LogContext): void {
  const key = `${message}:${channelId}`;
  const now = Date.now();
  const lastWarnedAt = warningCache.get(key);
  if (lastWarnedAt && now - lastWarnedAt < DEFAULT_WARNING_SUPPRESS_MS) {
    return;
  }
  warningCache.set(key, now);
  logWarn(message, context);
}
