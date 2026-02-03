import {
  ChannelType,
  PermissionFlagsBits,
  type Channel,
  type Client,
  type RepliableInteraction,
} from "discord.js";

import {
  buildChannelServiceError,
  cleanupMissingChannelStatus,
  describeSendableChannelStatus,
  formatCannotPostMessage,
  formatCannotPostPermissionsMessage,
  getSendableChannelStatus,
  getSendableChannelStatuses,
  getSendableChannelStatusOrWarn,
  resolveChannelCleanupDecision,
  resolveSendableChannelForService,
  resolveSendableChannel,
  resolveSendableChannelOrReply,
  resolveSendableChannelOrWarn,
  resetChannelWarningCache,
} from "../../src/utils/discordChannels.js";
import * as logger from "../../src/utils/logger.js";

describe("getSendableChannelStatus", () => {
  it("returns ok when the channel is sendable", async () => {
    const channel = { type: ChannelType.GuildText };
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;

    const result = await getSendableChannelStatus(client, "channel-1");

    expect(result).toEqual({ status: "ok", channel });
  });

  it("returns missing when the channel does not exist", async () => {
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as unknown as Client;

    const result = await getSendableChannelStatus(client, "channel-2");

    expect(result).toEqual({ status: "missing", channelId: "channel-2" });
  });

  it("returns missing_permissions when permissions are incomplete", async () => {
    const channel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel,
      }),
    };
    const client = {
      user: { id: "user-1" },
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;

    const result = await getSendableChannelStatus(client, "channel-3");

    expect(result).toEqual({
      status: "missing_permissions",
      channelId: "channel-3",
      missingPermissions: ["SendMessages"],
    });
  });
});

describe("getSendableChannelStatuses", () => {
  it("dedupes channel fetches per channel id", async () => {
    const fetch = jest.fn().mockImplementation(async (channelId: string) => ({
      id: channelId,
      type: ChannelType.GuildText,
    }));
    const client = {
      channels: {
        fetch,
      },
    } as unknown as Client;

    const result = await getSendableChannelStatuses(client, [
      "channel-1",
      "channel-1",
      "channel-2",
    ]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith("channel-1");
    expect(fetch).toHaveBeenCalledWith("channel-2");
    expect(result).toHaveLength(3);
    expect(result[0]?.status).toBe("ok");
    expect(result[1]?.status).toBe("ok");
    expect(result[2]?.status).toBe("ok");
  });
});

describe("getSendableChannelStatusOrWarn", () => {
  beforeEach(() => {
    resetChannelWarningCache();
  });

  it("returns status and logs when the channel is missing", async () => {
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as unknown as Client;
    const logWarn = jest.spyOn(logger, "logWarn").mockImplementation(() => {});

    const result = await getSendableChannelStatusOrWarn(client, "channel-10", "Missing channel", {
      guildId: "guild-10",
    });

    expect(result).toEqual({ status: "missing", channelId: "channel-10" });
    expect(logWarn).toHaveBeenCalledWith("Missing channel", {
      guildId: "guild-10",
      channelId: "channel-10",
    });
    logWarn.mockRestore();
  });
});

describe("describeSendableChannelStatus", () => {
  it("formats missing and permission statuses", () => {
    expect(describeSendableChannelStatus({ status: "missing", channelId: "c-1" })).toBe(
      "Missing or deleted"
    );
    expect(
      describeSendableChannelStatus({
        status: "missing_permissions",
        channelId: "c-2",
        missingPermissions: ["SendMessages"],
      })
    ).toBe("Missing permissions (SendMessages)");
  });
});

describe("formatCannotPostMessage", () => {
  it("renders a consistent reply for missing permissions", () => {
    expect(
      formatCannotPostMessage("channel-1", {
        status: "missing_permissions",
        channelId: "channel-1",
        missingPermissions: ["SendMessages"],
      })
    ).toBe(
      "I can't post in <#channel-1> (Missing permissions (SendMessages)). Check the bot permissions and try again."
    );
  });
});

describe("formatCannotPostPermissionsMessage", () => {
  it("wraps missing permissions into a consistent reply", () => {
    expect(
      formatCannotPostPermissionsMessage("channel-2", ["SendMessages"])
    ).toBe(
      "I can't post in <#channel-2> (Missing permissions (SendMessages)). Check the bot permissions and try again."
    );
  });
});

describe("buildChannelServiceError", () => {
  it("formats a consistent service error message", () => {
    const error = buildChannelServiceError("Weekly digest", "channel-9", {
      status: "missing_permissions",
      channelId: "channel-9",
      missingPermissions: ["SendMessages"],
    });

    expect(error).toEqual({
      message: "Weekly digest channel channel-9: Missing permissions (SendMessages)",
      timestamp: expect.any(String),
    });
  });
});

describe("resolveSendableChannel", () => {
  beforeEach(() => {
    resetChannelWarningCache();
  });

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

  it("returns null when missing send permissions", async () => {
    const channel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: (flag: bigint) => flag !== PermissionFlagsBits.SendMessages,
      }),
    };
    const client = {
      user: { id: "user-1" },
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;

    const result = await resolveSendableChannel(client, "channel-1");

    expect(result).toBeNull();
  });

  it("logs a warning when a sendable channel is missing", async () => {
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as unknown as Client;
    const logWarn = jest.spyOn(logger, "logWarn").mockImplementation(() => {});

    const result = await resolveSendableChannelOrWarn(client, "channel-2", "Missing channel", {
      guildId: "guild-1",
    });

    expect(result).toBeNull();
    expect(logWarn).toHaveBeenCalledWith("Missing channel", {
      guildId: "guild-1",
      channelId: "channel-2",
    });
    logWarn.mockRestore();
  });

  it("logs a warning when missing send permissions", async () => {
    const channel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel,
      }),
    };
    const client = {
      user: { id: "user-1" },
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;
    const logWarn = jest.spyOn(logger, "logWarn").mockImplementation(() => {});

    const result = await resolveSendableChannelOrWarn(client, "channel-3", "Missing perms", {
      guildId: "guild-2",
    });

    expect(result).toBeNull();
    expect(logWarn).toHaveBeenCalledWith("Missing perms", {
      guildId: "guild-2",
      channelId: "channel-3",
      missingPermissions: ["SendMessages"],
    });
    logWarn.mockRestore();
  });

  it("suppresses repeated channel warnings", async () => {
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as unknown as Client;
    const logWarn = jest.spyOn(logger, "logWarn").mockImplementation(() => {});

    await resolveSendableChannelOrWarn(client, "channel-4", "Missing channel", {
      guildId: "guild-3",
    });
    await resolveSendableChannelOrWarn(client, "channel-4", "Missing channel", {
      guildId: "guild-3",
    });

    expect(logWarn).toHaveBeenCalledTimes(1);
    logWarn.mockRestore();
  });
});

describe("resolveChannelCleanupDecision", () => {
  it("returns a reply when the channel is healthy", async () => {
    const channel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn().mockReturnValue(true),
      }),
    };
    const client = {
      user: { id: "user-1" },
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;

    const result = await resolveChannelCleanupDecision({
      client,
      channelId: "channel-1",
      includePermissions: false,
      healthyMessage: "All good.",
      missingPermissionsMessage: () => "Missing perms.",
    });

    expect(result.shouldRemove).toBe(false);
    expect(result.replyMessage).toBe("All good.");
  });

  it("returns a reply when permissions are missing and cleanup is not forced", async () => {
    const channel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel,
      }),
    };
    const client = {
      user: { id: "user-1" },
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;

    const result = await resolveChannelCleanupDecision({
      client,
      channelId: "channel-2",
      includePermissions: false,
      healthyMessage: "All good.",
      missingPermissionsMessage: (status) =>
        `Missing ${describeSendableChannelStatus(status)}.`,
    });

    expect(result.shouldRemove).toBe(false);
    expect(result.replyMessage).toBe("Missing Missing permissions (SendMessages).");
  });

  it("allows cleanup when the channel is missing", async () => {
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as unknown as Client;

    const result = await resolveChannelCleanupDecision({
      client,
      channelId: "channel-3",
      includePermissions: false,
      healthyMessage: "All good.",
      missingPermissionsMessage: () => "Missing perms.",
    });

    expect(result.shouldRemove).toBe(true);
    expect(result.replyMessage).toBeNull();
    expect(result.status).toEqual({ status: "missing", channelId: "channel-3" });
  });
});

describe("resolveSendableChannelForService", () => {
  beforeEach(() => {
    resetChannelWarningCache();
  });

  it("returns channel when sendable", async () => {
    const channel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({ has: () => true }),
    };
    const client = {
      user: { id: "user-1" },
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;

    const remove = jest.fn().mockResolvedValue(true);

    const result = await resolveSendableChannelForService({
      client,
      channelId: "channel-10",
      warnMessage: "Missing channel",
      warnContext: { guildId: "guild-10" },
      cleanup: {
        remove,
        logRemoved: jest.fn(),
        logFailed: jest.fn(),
      },
      serviceLabel: "Practice reminder",
    });

    expect(result.channel).toBe(channel);
    expect(result.serviceError).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("cleans up missing channels and returns a service error", async () => {
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as unknown as Client;
    const logWarn = jest.spyOn(logger, "logWarn").mockImplementation(() => {});

    const remove = jest.fn().mockResolvedValue(true);
    const logRemoved = jest.fn();
    const logFailed = jest.fn();

    const result = await resolveSendableChannelForService({
      client,
      channelId: "channel-11",
      warnMessage: "Missing channel",
      warnContext: { guildId: "guild-11" },
      cleanup: {
        remove,
        logRemoved,
        logFailed,
      },
      serviceLabel: "Contest reminder",
    });

    expect(result.channel).toBeNull();
    expect(result.serviceError?.message).toBe(
      "Contest reminder channel channel-11: Missing or deleted"
    );
    expect(remove).toHaveBeenCalled();
    expect(logRemoved).toHaveBeenCalled();
    expect(logFailed).not.toHaveBeenCalled();
    logWarn.mockRestore();
  });

  it("returns a service error when missing permissions", async () => {
    const channel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel,
      }),
    };
    const client = {
      user: { id: "user-2" },
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    } as unknown as Client;
    const logWarn = jest.spyOn(logger, "logWarn").mockImplementation(() => {});

    const remove = jest.fn().mockResolvedValue(true);

    const result = await resolveSendableChannelForService({
      client,
      channelId: "channel-12",
      warnMessage: "Missing channel",
      warnContext: { guildId: "guild-12" },
      cleanup: {
        remove,
        logRemoved: jest.fn(),
        logFailed: jest.fn(),
      },
      serviceLabel: "Contest rating alert",
    });

    expect(result.channel).toBeNull();
    expect(result.serviceError?.message).toBe(
      "Contest rating alert channel channel-12: Missing permissions (SendMessages)"
    );
    expect(remove).not.toHaveBeenCalled();
    logWarn.mockRestore();
  });
});

describe("cleanupMissingChannelStatus", () => {
  it("removes and logs when the channel is missing", async () => {
    const remove = jest.fn().mockResolvedValue(true);
    const logRemoved = jest.fn();
    const logFailed = jest.fn();

    const result = await cleanupMissingChannelStatus({
      status: { status: "missing", channelId: "channel-1" },
      remove,
      logRemoved,
      logFailed,
    });

    expect(result).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(logRemoved).toHaveBeenCalledTimes(1);
    expect(logFailed).not.toHaveBeenCalled();
  });

  it("skips cleanup when the channel is not missing", async () => {
    const remove = jest.fn().mockResolvedValue(true);
    const logRemoved = jest.fn();
    const logFailed = jest.fn();

    const result = await cleanupMissingChannelStatus({
      status: { status: "missing_permissions", channelId: "channel-2", missingPermissions: [] },
      remove,
      logRemoved,
      logFailed,
    });

    expect(result).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(logRemoved).not.toHaveBeenCalled();
    expect(logFailed).not.toHaveBeenCalled();
  });
});

describe("resolveSendableChannelOrReply", () => {
  it("replies when the channel type is invalid", async () => {
    const channel = { id: "channel-1", type: ChannelType.GuildVoice };
    const interaction = { reply: jest.fn().mockResolvedValue(undefined) };
    const client = { channels: { fetch: jest.fn() } } as unknown as Client;

    const result = await resolveSendableChannelOrReply(
      interaction as unknown as RepliableInteraction,
      client,
      channel as unknown as Channel,
      { invalidTypeMessage: "Pick a text channel." }
    );

    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalledWith({ content: "Pick a text channel." });
  });

  it("replies when missing permissions", async () => {
    const channel = {
      id: "channel-2",
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel,
      }),
    };
    const interaction = { reply: jest.fn().mockResolvedValue(undefined) };
    const client = { user: { id: "user-1" } } as unknown as Client;

    const result = await resolveSendableChannelOrReply(
      interaction as unknown as RepliableInteraction,
      client,
      channel as unknown as Channel,
      { invalidTypeMessage: "Pick a text channel." }
    );

    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "I can't post in <#channel-2> (Missing permissions (SendMessages)). Check the bot permissions and try again.",
    });
  });

  it("returns the channel when sendable", async () => {
    const channel = {
      id: "channel-3",
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: () => true,
      }),
    };
    const interaction = { reply: jest.fn().mockResolvedValue(undefined) };
    const client = { user: { id: "user-1" } } as unknown as Client;

    const result = await resolveSendableChannelOrReply(
      interaction as unknown as RepliableInteraction,
      client,
      channel as unknown as Channel,
      { invalidTypeMessage: "Pick a text channel." }
    );

    expect(result).toBe(channel);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
