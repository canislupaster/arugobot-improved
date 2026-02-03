import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";

import {
  cleanupChannelSubscriptions,
  formatPermissionIssueSummary,
} from "../../src/utils/channelCleanup.js";

const createClient = (channels: Record<string, unknown | null>): Client =>
  ({
    user: { id: "bot-1" },
    channels: {
      fetch: jest.fn((id: string) => Promise.resolve(channels[id] ?? null)),
    },
  }) as unknown as Client;

describe("cleanupChannelSubscriptions", () => {
  it("removes missing channels and reports missing permissions when not forced", async () => {
    const okChannel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({ has: () => true }),
    };
    const missingPermChannel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel,
      }),
    };

    const client = createClient({
      "channel-ok": okChannel,
      "channel-missing-perms": missingPermChannel,
    });

    const removeSubscription = jest.fn().mockResolvedValue(true);

    const result = await cleanupChannelSubscriptions({
      client,
      includePermissions: false,
      removeSubscription,
      subscriptions: [
        { id: "sub-missing", channelId: "channel-missing" },
        { id: "sub-missing-perms", channelId: "channel-missing-perms" },
        { id: "sub-ok", channelId: "channel-ok" },
      ],
    });

    expect(result.removedIds).toEqual(["sub-missing"]);
    expect(result.removedPermissionIds).toEqual([]);
    expect(result.failedIds).toEqual([]);
    expect(result.failedPermissionIds).toEqual([]);
    expect(result.permissionIssues).toHaveLength(1);
    expect(result.permissionIssues[0]?.id).toBe("sub-missing-perms");
    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });

  it("removes missing permission subscriptions when forced", async () => {
    const missingPermChannel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel,
      }),
    };
    const client = createClient({
      "channel-missing-perms": missingPermChannel,
    });

    const removeSubscription = jest.fn().mockResolvedValue(true);

    const result = await cleanupChannelSubscriptions({
      client,
      includePermissions: true,
      removeSubscription,
      subscriptions: [{ id: "sub-missing-perms", channelId: "channel-missing-perms" }],
    });

    expect(result.removedPermissionIds).toEqual(["sub-missing-perms"]);
    expect(result.permissionIssues).toEqual([]);
    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });
});

describe("formatPermissionIssueSummary", () => {
  it("returns null when there are no issues", () => {
    expect(formatPermissionIssueSummary([])).toBeNull();
  });

  it("formats missing permission issue lines", () => {
    const summary = formatPermissionIssueSummary([
      {
        id: "sub-1",
        channelId: "channel-1",
        status: {
          status: "missing_permissions",
          channelId: "channel-1",
          missingPermissions: ["SendMessages"],
        },
      },
    ]);

    expect(summary).toBe(
      "Subscriptions with missing permissions (not removed): `sub-1` (<#channel-1>): Missing permissions (SendMessages)."
    );
  });
});
