import type { Client } from "discord.js";

import { resolveSendableChannel, type SendableChannel } from "./discordChannels.js";
import { wasSentSince } from "./time.js";

export type ManualSendCheckResult =
  | { status: "ready"; channel: SendableChannel }
  | { status: "already_sent"; lastSentAt: string }
  | { status: "channel_missing"; channelId: string };

export type ManualSendFailure =
  | { status: "already_sent"; lastSentAt: string }
  | { status: "channel_missing"; channelId: string };

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

  const channel = await resolveSendableChannel(client, params.channelId);
  if (!channel) {
    return { status: "channel_missing", channelId: params.channelId };
  }

  return { status: "ready", channel };
}

export function getManualSendFailure(
  result: Exclude<ManualSendCheckResult, { status: "ready"; channel: SendableChannel }>
): ManualSendFailure {
  if (result.status === "already_sent") {
    return { status: "already_sent", lastSentAt: result.lastSentAt };
  }
  return { status: "channel_missing", channelId: result.channelId };
}
