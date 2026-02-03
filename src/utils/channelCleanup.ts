import type { Client } from "discord.js";

import {
  describeSendableChannelStatus,
  getSendableChannelStatus,
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

export async function cleanupChannelSubscriptions(
  options: ChannelCleanupOptions
): Promise<ChannelCleanupResult> {
  const channelStatuses = await Promise.all(
    options.subscriptions.map((subscription) =>
      getSendableChannelStatus(options.client, subscription.channelId)
    )
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

export function formatIdList(ids: string[]): string {
  return ids.map((id) => `\`${id}\``).join(", ");
}

export function formatPermissionIssueSummary(
  permissionIssues: ChannelCleanupIssue[]
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
  return `Subscriptions with missing permissions (not removed): ${issueLines.join("; ")}.`;
}
