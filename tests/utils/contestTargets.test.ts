import type { User } from "discord.js";

import { resolveContestTargets } from "../../src/utils/contestTargets.js";

describe("resolveContestTargets", () => {
  const baseParams = {
    guild: null,
    guildId: "guild-1",
    user: { id: "user-1" } as User,
    commandName: "contestresults",
    correlationId: "corr-1",
  };

  it("resolves linked users and explicit handles", async () => {
    const store = {
      getHandle: jest.fn().mockResolvedValue("petr"),
      resolveHandle: jest.fn().mockResolvedValue({ exists: true, canonicalHandle: "tourist" }),
      getLinkedUsers: jest.fn(),
    };

    const result = await resolveContestTargets({
      ...baseParams,
      userOptions: [{ id: "user-2" } as User],
      handleInputs: ["tourist"],
      store,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.targets).toEqual([
        { handle: "petr", label: "<@user-2>" },
        { handle: "tourist", label: "tourist" },
      ]);
    }
  });

  it("returns an error for invalid handles", async () => {
    const store = {
      getHandle: jest.fn(),
      resolveHandle: jest.fn().mockResolvedValue({ exists: false, canonicalHandle: null }),
      getLinkedUsers: jest.fn(),
    };

    const result = await resolveContestTargets({
      ...baseParams,
      userOptions: [],
      handleInputs: ["nope"],
      store,
    });

    expect(result).toEqual({ status: "error", message: "Invalid handle: nope" });
  });

  it("rejects user options outside a guild", async () => {
    const store = {
      getHandle: jest.fn(),
      resolveHandle: jest.fn(),
      getLinkedUsers: jest.fn(),
    };

    const result = await resolveContestTargets({
      ...baseParams,
      guildId: null,
      userOptions: [{ id: "user-2" } as User],
      handleInputs: [],
      store,
    });

    expect(result).toEqual({
      status: "error",
      message: "Specify handles directly when using this command outside a server.",
    });
  });

  it("returns an error when no linked handles exist", async () => {
    const store = {
      getHandle: jest.fn(),
      resolveHandle: jest.fn(),
      getLinkedUsers: jest.fn().mockResolvedValue([]),
    };

    const result = await resolveContestTargets({
      ...baseParams,
      userOptions: [],
      handleInputs: [],
      store,
    });

    expect(result).toEqual({
      status: "error",
      message: "No linked handles found in this server yet.",
    });
  });

  it("dedupes user options before resolving handles", async () => {
    const store = {
      getHandle: jest.fn().mockResolvedValue("tourist"),
      resolveHandle: jest.fn(),
      getLinkedUsers: jest.fn(),
    };

    const user = { id: "user-2" } as User;
    const result = await resolveContestTargets({
      ...baseParams,
      userOptions: [user, user],
      handleInputs: [],
      store,
    });

    expect(result.status).toBe("ok");
    expect(store.getHandle).toHaveBeenCalledTimes(1);
  });
});
