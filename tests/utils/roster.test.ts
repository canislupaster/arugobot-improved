import type { Guild } from "discord.js";

import { resolveGuildRoster } from "../../src/utils/roster.js";

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
      expect(result.message).toContain("No linked handles found for current server members.");
    }
  });
});
