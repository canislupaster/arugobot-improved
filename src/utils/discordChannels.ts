import {
  ChannelType,
  PermissionFlagsBits,
  type Channel,
  type Client,
  type NewsChannel,
  type RepliableInteraction,
  type TextChannel,
} from "discord.js";

import { buildServiceError, type ServiceError } from "./errors.js";
import { logWarn, type LogContext } from "./logger.js";

export type SendableChannel = TextChannel | NewsChannel;
export type SendableChannelStatus =
  | { status: "ok"; channel: SendableChannel }
  | { status: "missing"; channelId: string }
  | { status: "missing_permissions"; channelId: string; missingPermissions: string[] };
type ChannelLike = {
  id: string;
  type: ChannelType;
  permissionsFor?: unknown;
};

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

export async function getSendableChannelStatus(
  client: Client,
  channelId: string
): Promise<SendableChannelStatus> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return getSendableChannelStatusForChannel(client, channel, channelId);
}

export async function getSendableChannelStatusOrWarn(
  client: Client,
  channelId: string,
  message: string,
  context: LogContext = {}
): Promise<SendableChannelStatus> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const status = getSendableChannelStatusForChannel(client, channel, channelId);
  if (status.status !== "ok") {
    logChannelWarning(message, channelId, {
      ...context,
      channelId,
      ...(status.status === "missing_permissions"
        ? { missingPermissions: status.missingPermissions }
        : {}),
    });
  }
  return status;
}

export function getSendableChannelStatusForChannel(
  client: Client,
  channel: Channel | null,
  channelId?: string
): SendableChannelStatus {
  const resolvedChannelId = channelId ?? channel?.id ?? "unknown";
  if (!channel || !isSendableChannel(channel)) {
    return { status: "missing", channelId: resolvedChannelId };
  }
  const missingPermissions = getMissingSendPermissions(channel, client);
  if (missingPermissions) {
    return { status: "missing_permissions", channelId: resolvedChannelId, missingPermissions };
  }
  return { status: "ok", channel };
}

export function describeSendableChannelStatus(status: SendableChannelStatus): string {
  if (status.status === "missing") {
    return "Missing or deleted";
  }
  if (status.status === "missing_permissions") {
    return `Missing permissions (${status.missingPermissions.join(", ")})`;
  }
  return "OK";
}

export function formatCannotPostMessage(
  channelId: string,
  status: SendableChannelStatus
): string {
  return `I can't post in <#${channelId}> (${describeSendableChannelStatus(
    status
  )}). Check the bot permissions and try again.`;
}

export function buildChannelServiceError(
  label: string,
  channelId: string,
  status: SendableChannelStatus
): ServiceError | null {
  return buildServiceError(`${label} channel ${channelId}: ${describeSendableChannelStatus(status)}`);
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

export async function resolveSendableChannelOrReply(
  interaction: RepliableInteraction,
  client: Client,
  channel: Channel | ChannelLike | null,
  options: { invalidTypeMessage: string }
): Promise<SendableChannel | null> {
  if (
    !channel ||
    (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
  ) {
    await interaction.reply({ content: options.invalidTypeMessage });
    return null;
  }
  const hasPermissionsFor =
    "permissionsFor" in channel && typeof (channel as ChannelLike).permissionsFor === "function";
  const status = hasPermissionsFor
    ? getSendableChannelStatusForChannel(client, channel as Channel, channel.id)
    : await getSendableChannelStatus(client, channel.id);
  if (status.status !== "ok") {
    await interaction.reply({ content: formatCannotPostMessage(channel.id, status) });
    return null;
  }
  return channel as SendableChannel;
}

export async function resolveSendableChannelOrWarn(
  client: Client,
  channelId: string,
  message: string,
  context: LogContext = {}
): Promise<SendableChannel | null> {
  const status = await getSendableChannelStatusOrWarn(client, channelId, message, context);
  return status.status === "ok" ? status.channel : null;
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
