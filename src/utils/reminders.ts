import type { Client } from "discord.js";

import { getSendableChannelStatus, type SendableChannel } from "./discordChannels.js";
import { recordServiceErrorMessage, type ServiceError } from "./errors.js";
import { wasSentSince } from "./time.js";

export type ManualSendCheckResult =
  | { status: "ready"; channel: SendableChannel }
  | { status: "already_sent"; lastSentAt: string }
  | { status: "channel_missing"; channelId: string }
  | { status: "channel_missing_permissions"; channelId: string; missingPermissions: string[] };

export type ManualSendFailure =
  | { status: "already_sent"; lastSentAt: string }
  | { status: "channel_missing"; channelId: string }
  | { status: "channel_missing_permissions"; channelId: string; missingPermissions: string[] };

export async function resolveManualSendChannel(
  client: Client,
  params: {
    channelId: string;
    lastSentAt: string | null;
    force: boolean;
    periodStartMs: number;
  }
): Promise<ManualSendCheckResult> {
  if (!params.force && wasSentSince(params.lastSentAt, params.periodStartMs)) {
    return {
      status: "already_sent",
      lastSentAt: params.lastSentAt ?? new Date().toISOString(),
    };
  }

  const status = await getSendableChannelStatus(client, params.channelId);
  if (status.status === "missing") {
    return { status: "channel_missing", channelId: params.channelId };
  }
  if (status.status === "missing_permissions") {
    return {
      status: "channel_missing_permissions",
      channelId: params.channelId,
      missingPermissions: status.missingPermissions,
    };
  }
  return { status: "ready", channel: status.channel };
}

export function getManualSendFailure(
  result: Exclude<ManualSendCheckResult, { status: "ready"; channel: SendableChannel }>
): ManualSendFailure {
  if (result.status === "already_sent") {
    return { status: "already_sent", lastSentAt: result.lastSentAt };
  }
  if (result.status === "channel_missing_permissions") {
    return {
      status: "channel_missing_permissions",
      channelId: result.channelId,
      missingPermissions: result.missingPermissions,
    };
  }
  return { status: "channel_missing", channelId: result.channelId };
}

export function recordReminderSendFailure(params: {
  error: unknown;
  record: (serviceError: ServiceError) => void;
  log: (message: string, context?: Record<string, unknown>) => void;
  logMessage: string;
  logContext: Record<string, unknown>;
}): string {
  const message = recordServiceErrorMessage(params.error, params.record);
  params.log(params.logMessage, { ...params.logContext, error: message });
  return message;
}
