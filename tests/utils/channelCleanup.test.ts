import {
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";

import {
  buildSingleChannelCleanupMessages,
  buildChannelCleanupSummary,
  cleanupChannelSubscriptions,
  cleanupSingleChannelSubscription,
  getSingleChannelCleanupReply,
  formatPermissionIssueSummary,
  replyWithChannelCleanupSummary,
  runChannelCleanupSummary,
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

  it("dedupes channel lookups when subscriptions share a channel", async () => {
    const okChannel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({ has: () => true }),
    };
    const client = createClient({ "channel-ok": okChannel });
    const removeSubscription = jest.fn().mockResolvedValue(true);

    await cleanupChannelSubscriptions({
      client,
      includePermissions: false,
      removeSubscription,
      subscriptions: [
        { id: "sub-1", channelId: "channel-ok" },
        { id: "sub-2", channelId: "channel-ok" },
      ],
    });

    expect(client.channels.fetch).toHaveBeenCalledTimes(1);
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

describe("buildSingleChannelCleanupMessages", () => {
  it("builds consistent cleanup text for a single channel", () => {
    const messages = buildSingleChannelCleanupMessages({
      channelId: "channel-1",
      channelLabel: "Practice reminder",
      subjectLabel: "Practice reminders",
      subject: "practice reminders",
      setCommand: "/practicereminders set",
    });

    expect(messages.healthyMessage).toBe(
      "Practice reminder channel looks healthy; nothing to clean."
    );
    expect(
      messages.missingPermissionsMessage({
        status: "missing_permissions",
        channelId: "channel-1",
        missingPermissions: ["SendMessages"],
      })
    ).toBe(
      "Practice reminders still point at <#channel-1> (Missing permissions (SendMessages)). Re-run with include_permissions:true or update the channel with /practicereminders set."
    );
    expect(
      messages.removedMessage({
        status: "missing",
        channelId: "channel-1",
      })
    ).toBe("Removed practice reminders for <#channel-1> (Missing or deleted).");
    expect(messages.failedMessage).toBe("Failed to remove practice reminders. Try again later.");
  });
});

describe("buildChannelCleanupSummary", () => {
  it("returns the all-good message when there are no issues", () => {
    const summary = buildChannelCleanupSummary(
      {
        removedIds: [],
        removedPermissionIds: [],
        failedIds: [],
        failedPermissionIds: [],
        permissionIssues: [],
      },
      {
        label: "contest reminder subscription",
        allGoodMessage: "All contest reminder channels look good.",
      }
    );

    expect(summary).toBe("All contest reminder channels look good.");
  });

  it("formats cleanup lines in order with permission hints", () => {
    const summary = buildChannelCleanupSummary(
      {
        removedIds: ["sub-missing"],
        removedPermissionIds: ["sub-missing-perms"],
        failedIds: ["sub-failed"],
        failedPermissionIds: ["sub-failed-perms"],
        permissionIssues: [
          {
            id: "sub-perms",
            channelId: "channel-1",
            status: {
              status: "missing_permissions",
              channelId: "channel-1",
              missingPermissions: ["SendMessages"],
            },
          },
        ],
      },
      {
        label: "contest reminder subscription",
        allGoodMessage: "All contest reminder channels look good.",
        cleanupHint: "Use /contestreminders cleanup include_permissions:true to remove them.",
      }
    );

    expect(summary).toBe(
      [
        "Removed 1 contest reminder subscription with missing channels: `sub-missing`.",
        "Removed 1 contest reminder subscription with missing permissions: `sub-missing-perms`.",
        "Failed to remove 1 subscription: `sub-failed`.",
        "Failed to remove 1 subscription with missing permissions: `sub-failed-perms`.",
        "Subscriptions with missing permissions (not removed): `sub-perms` (<#channel-1>): Missing permissions (SendMessages). Use /contestreminders cleanup include_permissions:true to remove them.",
      ].join("\n")
    );
  });
});

describe("replyWithChannelCleanupSummary", () => {
  it("replies with the empty message when there are no subscriptions", async () => {
    const interaction = {
      options: { getBoolean: jest.fn().mockReturnValue(false) },
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
    const client = createClient({});

    await replyWithChannelCleanupSummary({
      interaction,
      client,
      listSubscriptions: async () => [],
      removeSubscription: jest.fn(),
      emptyMessage: "No subscriptions.",
      summary: {
        label: "contest reminder subscription",
        allGoodMessage: "All contest reminder channels look good.",
      },
    });

    expect(interaction.reply).toHaveBeenCalledWith({ content: "No subscriptions." });
  });
});

describe("runChannelCleanupSummary", () => {
  it("returns the empty message when there are no subscriptions", async () => {
    const client = createClient({});
    const removeSubscription = jest.fn().mockResolvedValue(true);

    const message = await runChannelCleanupSummary({
      client,
      subscriptions: [],
      includePermissions: false,
      removeSubscription,
      emptyMessage: "No subscriptions configured.",
      summary: {
        label: "contest reminder subscription",
        allGoodMessage: "All contest reminder channels look good.",
      },
    });

    expect(message).toBe("No subscriptions configured.");
    expect(removeSubscription).not.toHaveBeenCalled();
  });

  it("returns the summary message when cleanup runs", async () => {
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

    const message = await runChannelCleanupSummary({
      client,
      subscriptions: [{ id: "sub-missing-perms", channelId: "channel-missing-perms" }],
      includePermissions: true,
      removeSubscription,
      emptyMessage: "No subscriptions configured.",
      summary: {
        label: "contest reminder subscription",
        allGoodMessage: "All contest reminder channels look good.",
      },
    });

    expect(message).toBe(
      "Removed 1 contest reminder subscription with missing permissions: `sub-missing-perms`."
    );
    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });
});

describe("cleanupSingleChannelSubscription", () => {
  it("returns healthy message without removing", async () => {
    const okChannel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({ has: () => true }),
    };
    const client = createClient({ "channel-ok": okChannel });
    const remove = jest.fn().mockResolvedValue(true);

    const message = await cleanupSingleChannelSubscription({
      client,
      channelId: "channel-ok",
      includePermissions: false,
      healthyMessage: "Healthy channel.",
      missingPermissionsMessage: () => "Missing perms.",
      remove,
      removedMessage: () => "Removed.",
      failedMessage: "Failed.",
    });

    expect(message).toBe("Healthy channel.");
    expect(remove).not.toHaveBeenCalled();
  });

  it("returns missing permission guidance without removing", async () => {
    const missingPermChannel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel,
      }),
    };
    const client = createClient({ "channel-perms": missingPermChannel });
    const remove = jest.fn().mockResolvedValue(true);

    const message = await cleanupSingleChannelSubscription({
      client,
      channelId: "channel-perms",
      includePermissions: false,
      healthyMessage: "Healthy channel.",
      missingPermissionsMessage: (status) => `Missing: ${status.missingPermissions.join(", ")}`,
      remove,
      removedMessage: () => "Removed.",
      failedMessage: "Failed.",
    });

    expect(message).toBe("Missing: SendMessages");
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes missing channels and reports removal", async () => {
    const client = createClient({});
    const remove = jest.fn().mockResolvedValue(true);

    const message = await cleanupSingleChannelSubscription({
      client,
      channelId: "channel-missing",
      includePermissions: false,
      healthyMessage: "Healthy channel.",
      missingPermissionsMessage: () => "Missing perms.",
      remove,
      removedMessage: (status) => `Removed (${status.status}).`,
      failedMessage: "Failed.",
    });

    expect(message).toBe("Removed (missing).");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("getSingleChannelCleanupReply", () => {
  it("builds cleanup messages and removes missing subscriptions", async () => {
    const client = createClient({});
    const remove = jest.fn().mockResolvedValue(true);

    const message = await getSingleChannelCleanupReply({
      client,
      channelId: "channel-1",
      includePermissions: false,
      channelLabel: "Weekly digest",
      subjectLabel: "Weekly digest",
      subject: "weekly digest",
      setCommand: "/digest set",
      subjectVerb: "points",
      remove,
    });

    expect(message).toBe("Removed weekly digest for <#channel-1> (Missing or deleted).");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
