import type { Guild } from "discord.js";

import { resolveMemberMentions } from "../../src/utils/guildMembers.js";
import * as logger from "../../src/utils/logger.js";

describe("resolveMemberMentions", () => {
  const createMember = (id: string) => ({
    user: { id },
    toString: () => `<@${id}>`,
  });

  it("returns mentions for fetched members", async () => {
    const members = new Map([
      ["user-1", createMember("user-1")],
      ["user-2", createMember("user-2")],
    ]);
    const guild = {
      id: "guild-1",
      members: {
        fetch: jest.fn().mockResolvedValue(members),
        cache: new Map(),
      },
    } as unknown as Guild;

    const result = await resolveMemberMentions(guild, ["user-1", "user-2"]);

    expect(result.get("user-1")).toBe("<@user-1>");
    expect(result.get("user-2")).toBe("<@user-2>");
  });

  it("falls back to cache and default mentions when fetch fails", async () => {
    const warnSpy = jest.spyOn(logger, "logWarn").mockImplementation(() => {});
    const guild = {
      id: "guild-1",
      members: {
        fetch: jest.fn().mockRejectedValue(new Error("boom")),
        cache: new Map([["user-1", createMember("user-1")]]),
      },
    } as unknown as Guild;

    const result = await resolveMemberMentions(guild, ["user-1", "user-2"]);

    expect(result.get("user-1")).toBe("<@user-1>");
    expect(result.get("user-2")).toBe("<@user-2>");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
