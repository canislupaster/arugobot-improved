import type { Guild } from "discord.js";

import {
  formatRatedRosterLines,
  resolveGuildRoster,
  resolveGuildRosterOrReply,
  resolveGuildRosterFromStoreOrReply,
} from "../../src/utils/roster.js";

const createGuild = (members: Array<{ id: string }>): Guild =>
  ({
    id: "guild-1",
    members: {
      fetch: jest
        .fn()
        .mockResolvedValue(new Map(members.map((member) => [member.id, { user: member }]))),
      cache: new Map(members.map((member) => [member.id, { user: member }])),
    },
  }) as unknown as Guild;

describe("resolveGuildRoster", () => {
  it("returns empty result when no handles are linked", async () => {
    const guild = createGuild([]);
    const result = await resolveGuildRoster(
      guild,
      [],
      { correlationId: "corr-1", command: "contestactivity", guildId: "guild-1", userId: "u1" }
    );

    expect(result.status).toBe("empty");
    if (result.status === "empty") {
      expect(result.reason).toBe("no_handles");
      expect(result.excludedCount).toBe(0);
      expect(result.message).toContain("No linked handles yet.");
    }
  });

  it("returns filtered roster when members are present", async () => {
    const guild = createGuild([{ id: "user-1" }, { id: "user-2" }]);
    const result = await resolveGuildRoster(
      guild,
      [
        { userId: "user-1", handle: "Alice" },
        { userId: "user-2", handle: "Bob" },
      ],
      { correlationId: "corr-2", command: "contestdeltas", guildId: "guild-1", userId: "u1" }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.roster).toHaveLength(2);
      expect(result.excludedCount).toBe(0);
    }
  });

  it("returns empty result when no current members match roster", async () => {
    const guild = createGuild([]);
    const result = await resolveGuildRoster(
      guild,
      [{ userId: "user-1", handle: "Alice" }],
      { correlationId: "corr-3", command: "contestactivity", guildId: "guild-1", userId: "u1" }
    );

    expect(result.status).toBe("empty");
    if (result.status === "empty") {
      expect(result.reason).toBe("no_members");
      expect(result.excludedCount).toBe(1);
      expect(result.message).toContain("No linked handles found for current server members.");
    }
  });

  it("allows custom empty messages", async () => {
    const guild = createGuild([]);
    const result = await resolveGuildRoster(
      guild,
      [],
      { correlationId: "corr-4", command: "contestactivity", guildId: "guild-1", userId: "u1" },
      { noHandles: "No handles configured." }
    );

    expect(result.status).toBe("empty");
    if (result.status === "empty") {
      expect(result.excludedCount).toBe(0);
      expect(result.message).toBe("No handles configured.");
    }
  });
});

describe("resolveGuildRosterOrReply", () => {
  it("replies when the roster is empty", async () => {
    const guild = createGuild([]);
    const interaction = { editReply: jest.fn().mockResolvedValue(undefined) };
    const result = await resolveGuildRosterOrReply(
      guild,
      [],
      { correlationId: "corr-5", command: "contestactivity", guildId: "guild-1", userId: "u1" },
      interaction
    );

    expect(result.status).toBe("replied");
    expect(interaction.editReply).toHaveBeenCalledWith(
      "No linked handles yet. Use /register to link a Codeforces handle."
    );
  });

  it("returns the roster when entries are valid", async () => {
    const guild = createGuild([{ id: "user-1" }]);
    const interaction = { editReply: jest.fn().mockResolvedValue(undefined) };
    const result = await resolveGuildRosterOrReply(
      guild,
      [{ userId: "user-1", handle: "Alice" }],
      { correlationId: "corr-6", command: "contestdeltas", guildId: "guild-1", userId: "u1" },
      interaction
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.roster).toHaveLength(1);
      expect(result.excludedCount).toBe(0);
    }
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe("resolveGuildRosterFromStoreOrReply", () => {
  it("loads roster from store and returns results", async () => {
    const guild = createGuild([{ id: "user-1" }]);
    const store = {
      getServerRoster: jest.fn().mockResolvedValue([{ userId: "user-1", handle: "Alice" }]),
    };
    const interaction = {
      commandName: "contestactivity",
      user: { id: "user-1" },
      editReply: jest.fn().mockResolvedValue(undefined),
    };

    const result = await resolveGuildRosterFromStoreOrReply({
      guild,
      interaction,
      store,
      correlationId: "corr-7",
    });

    expect(store.getServerRoster).toHaveBeenCalledWith("guild-1");
    expect(result.status).toBe("ok");
  });

  it("replies when the stored roster is empty", async () => {
    const guild = createGuild([]);
    const store = { getServerRoster: jest.fn().mockResolvedValue([]) };
    const interaction = {
      commandName: "contestdeltas",
      user: { id: "user-1" },
      editReply: jest.fn().mockResolvedValue(undefined),
    };

    const result = await resolveGuildRosterFromStoreOrReply({
      guild,
      interaction,
      store,
      correlationId: "corr-8",
    });

    expect(result.status).toBe("replied");
    expect(interaction.editReply).toHaveBeenCalledWith(
      "No linked handles yet. Use /register to link a Codeforces handle."
    );
  });
});

describe("formatRatedRosterLines", () => {
  it("formats numbered handle entries with ratings", () => {
    const lines = formatRatedRosterLines(
      [
        { userId: "user-1", handle: "tourist", rating: 3500 },
        { userId: "user-2", handle: "petr", rating: 3400 },
      ],
      0,
      1
    );

    expect(lines).toContain("1. <@user-1> - tourist (3500)");
    expect(lines).not.toContain("petr");
  });
});
