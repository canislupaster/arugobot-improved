import type { Client } from "discord.js";

import {
  describeSendableChannelStatus,
  getSendableChannelStatuses,
  resolveChannelCleanupDecision,
  type SendableChannelStatus,
} from "./discordChannels.js";

export type ChannelSubscription = {
  id: string;
  channelId: string;
};

export type ChannelCleanupIssue = {
  id: string;
  channelId: string;
  status: SendableChannelStatus;
};

export type ChannelCleanupResult = {
  removedIds: string[];
  removedPermissionIds: string[];
  failedIds: string[];
  failedPermissionIds: string[];
  permissionIssues: ChannelCleanupIssue[];
};

type ChannelCleanupOptions = {
  client: Client;
  subscriptions: ChannelSubscription[];
  includePermissions: boolean;
  removeSubscription: (id: string) => Promise<boolean>;
};

type ChannelCleanupSummaryOptions = {
  label: string;
  allGoodMessage: string;
  cleanupHint?: string;
};

export async function cleanupChannelSubscriptions(
  options: ChannelCleanupOptions
): Promise<ChannelCleanupResult> {
  const channelStatuses = await getSendableChannelStatuses(
    options.client,
    options.subscriptions.map((subscription) => subscription.channelId)
  );

  const removedIds: string[] = [];
  const removedPermissionIds: string[] = [];
  const failedIds: string[] = [];
  const failedPermissionIds: string[] = [];
  const permissionIssues: ChannelCleanupIssue[] = [];

  for (const [index, subscription] of options.subscriptions.entries()) {
    const status = channelStatuses[index]!;
    if (status.status === "missing") {
      const removed = await options.removeSubscription(subscription.id);
      if (removed) {
        removedIds.push(subscription.id);
      } else {
        failedIds.push(subscription.id);
      }
      continue;
    }
    if (status.status === "missing_permissions") {
      if (options.includePermissions) {
        const removed = await options.removeSubscription(subscription.id);
        if (removed) {
          removedPermissionIds.push(subscription.id);
        } else {
          failedPermissionIds.push(subscription.id);
        }
      } else {
        permissionIssues.push({
          id: subscription.id,
          channelId: subscription.channelId,
          status,
        });
      }
    }
  }

  return {
    removedIds,
    removedPermissionIds,
    failedIds,
    failedPermissionIds,
    permissionIssues,
  };
}

export async function cleanupSingleChannelSubscription(params: {
  client: Client;
  channelId: string;
  includePermissions: boolean;
  healthyMessage: string;
  missingPermissionsMessage: (
    status: Extract<SendableChannelStatus, { status: "missing_permissions" }>
  ) => string;
  remove: () => Promise<boolean>;
  removedMessage: (status: SendableChannelStatus) => string;
  failedMessage: string;
}): Promise<string> {
  const decision = await resolveChannelCleanupDecision({
    client: params.client,
    channelId: params.channelId,
    includePermissions: params.includePermissions,
    healthyMessage: params.healthyMessage,
    missingPermissionsMessage: params.missingPermissionsMessage,
  });
  if (decision.replyMessage) {
    return decision.replyMessage;
  }
  const removed = await params.remove();
  return removed ? params.removedMessage(decision.status) : params.failedMessage;
}

export function buildSingleChannelCleanupMessages(options: {
  channelId: string;
  channelLabel: string;
  subjectLabel: string;
  subject: string;
  setCommand: string;
  subjectVerb?: string;
}): {
  healthyMessage: string;
  missingPermissionsMessage: (
    status: Extract<SendableChannelStatus, { status: "missing_permissions" }>
  ) => string;
  removedMessage: (status: SendableChannelStatus) => string;
  failedMessage: string;
} {
  const subjectVerb = options.subjectVerb ?? "point";
  return {
    healthyMessage: `${options.channelLabel} channel looks healthy; nothing to clean.`,
    missingPermissionsMessage: (status) =>
      `${options.subjectLabel} still ${subjectVerb} at <#${options.channelId}> (${describeSendableChannelStatus(
        status
      )}). Re-run with include_permissions:true or update the channel with ${options.setCommand}.`,
    removedMessage: (status) =>
      `Removed ${options.subject} for <#${options.channelId}> (${describeSendableChannelStatus(
        status
      )}).`,
    failedMessage: `Failed to remove ${options.subject}. Try again later.`,
  };
}

export function formatIdList(ids: string[]): string {
  return ids.map((id) => `\`${id}\``).join(", ");
}

export function formatPermissionIssueSummary(
  permissionIssues: ChannelCleanupIssue[],
  options: { cleanupHint?: string } = {}
): string | null {
  if (permissionIssues.length === 0) {
    return null;
  }
  const issueLines = permissionIssues.map(
    (issue) =>
      `${formatIdList([issue.id])} (<#${issue.channelId}>): ${describeSendableChannelStatus(
        issue.status
      )}`
  );
  const summary = `Subscriptions with missing permissions (not removed): ${issueLines.join("; ")}.`;
  const hint = options.cleanupHint?.trim();
  return hint ? `${summary} ${hint}` : summary;
}

export function buildChannelCleanupSummary(
  cleanup: ChannelCleanupResult,
  options: {
    label: string;
    allGoodMessage: string;
    cleanupHint?: string;
  }
): string {
  const lines: string[] = [];
  const pluralize = (count: number) => (count === 1 ? "" : "s");

  if (cleanup.removedIds.length > 0) {
    lines.push(
      `Removed ${cleanup.removedIds.length} ${options.label}${pluralize(
        cleanup.removedIds.length
      )} with missing channels: ${formatIdList(cleanup.removedIds)}.`
    );
  }
  if (cleanup.removedPermissionIds.length > 0) {
    lines.push(
      `Removed ${cleanup.removedPermissionIds.length} ${options.label}${pluralize(
        cleanup.removedPermissionIds.length
      )} with missing permissions: ${formatIdList(cleanup.removedPermissionIds)}.`
    );
  }
  if (cleanup.failedIds.length > 0) {
    lines.push(
      `Failed to remove ${cleanup.failedIds.length} subscription${pluralize(
        cleanup.failedIds.length
      )}: ${formatIdList(cleanup.failedIds)}.`
    );
  }
  if (cleanup.failedPermissionIds.length > 0) {
    lines.push(
      `Failed to remove ${cleanup.failedPermissionIds.length} subscription${pluralize(
        cleanup.failedPermissionIds.length
      )} with missing permissions: ${formatIdList(cleanup.failedPermissionIds)}.`
    );
  }
  const permissionSummary = formatPermissionIssueSummary(cleanup.permissionIssues, {
    cleanupHint: options.cleanupHint,
  });
  if (permissionSummary) {
    lines.push(permissionSummary);
  }

  if (lines.length === 0) {
    return options.allGoodMessage;
  }
  return lines.join("\n");
}

export async function runChannelCleanupSummary(options: {
  client: Client;
  subscriptions: ChannelSubscription[];
  includePermissions: boolean;
  removeSubscription: (id: string) => Promise<boolean>;
  emptyMessage: string;
  summary: ChannelCleanupSummaryOptions;
}): Promise<string> {
  if (options.subscriptions.length === 0) {
    return options.emptyMessage;
  }

  const cleanup = await cleanupChannelSubscriptions({
    client: options.client,
    subscriptions: options.subscriptions,
    includePermissions: options.includePermissions,
    removeSubscription: options.removeSubscription,
  });
  return buildChannelCleanupSummary(cleanup, options.summary);
}
