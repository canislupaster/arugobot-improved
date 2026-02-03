import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";

import {
  getSendableChannelStatus,
  resolveSendableChannel,
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
