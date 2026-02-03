import type { Guild, User } from "discord.js";

import {
  getContestTargetContextError,
  resolveContestTargets,
  resolveContestTargetsOrReply,
} from "../../src/utils/contestTargets.js";

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

  it("enforces max linked handle limits", async () => {
    const store = {
      getHandle: jest.fn(),
      resolveHandle: jest.fn(),
      getLinkedUsers: jest.fn().mockResolvedValue([
        { userId: "user-2", handle: "tourist" },
        { userId: "user-3", handle: "petr" },
      ]),
    };

    const result = await resolveContestTargets({
      ...baseParams,
      userOptions: [],
      handleInputs: [],
      store,
      maxLinkedHandles: 1,
    });

    expect(result).toEqual({
      status: "error",
      message: "Too many linked handles (2). Provide specific handles or users.",
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

  it("dedupes handles across linked users and handle inputs", async () => {
    const store = {
      getHandle: jest.fn().mockResolvedValue("tourist"),
      resolveHandle: jest.fn().mockResolvedValue({ exists: true, canonicalHandle: "tourist" }),
      getLinkedUsers: jest.fn(),
    };

    const result = await resolveContestTargets({
      ...baseParams,
      userOptions: [{ id: "user-2" } as User],
      handleInputs: ["TOURIST"],
      store,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.targets).toEqual([{ handle: "tourist", label: "<@user-2>" }]);
    }
  });

  it("replies when contest targets fail", async () => {
    const store = {
      getHandle: jest.fn(),
      resolveHandle: jest.fn(),
      getLinkedUsers: jest.fn().mockResolvedValue([]),
    };
    const interaction = {
      editReply: jest.fn().mockResolvedValue(undefined),
    };

    const result = await resolveContestTargetsOrReply({
      ...baseParams,
      interaction,
      userOptions: [],
      handleInputs: [],
      store,
    });

    expect(result).toEqual({ status: "replied" });
    expect(interaction.editReply).toHaveBeenCalledWith(
      "No linked handles found in this server yet."
    );
  });

  it("returns targets without replying when contest targets resolve", async () => {
    const store = {
      getHandle: jest.fn().mockResolvedValue("petr"),
      resolveHandle: jest.fn(),
      getLinkedUsers: jest.fn(),
    };
    const interaction = {
      editReply: jest.fn().mockResolvedValue(undefined),
    };

    const result = await resolveContestTargetsOrReply({
      ...baseParams,
      interaction,
      userOptions: [{ id: "user-2" } as User],
      handleInputs: [],
      store,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.targets).toEqual([{ handle: "petr", label: "<@user-2>" }]);
    }
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe("getContestTargetContextError", () => {
  const guild = { id: "guild" } as Guild;
  const user = { id: "user" } as User;

  it("blocks user options in DMs", () => {
    expect(
      getContestTargetContextError({
        guild: null,
        userOptions: [user],
        handleInputs: ["tourist"],
      })
    ).toBe("Specify handles directly when using this command outside a server.");
  });

  it("requires at least one handle in DMs", () => {
    expect(
      getContestTargetContextError({
        guild: null,
        userOptions: [],
        handleInputs: [],
      })
    ).toBe("Provide at least one handle or run this command in a server.");
  });

  it("allows handles in DMs", () => {
    expect(
      getContestTargetContextError({
        guild: null,
        userOptions: [],
        handleInputs: ["tourist"],
      })
    ).toBeNull();
  });

  it("allows user options in guilds", () => {
    expect(
      getContestTargetContextError({
        guild,
        userOptions: [user],
        handleInputs: [],
      })
    ).toBeNull();
  });

  it("treats a guild id as guild context", () => {
    expect(
      getContestTargetContextError({
        guild: null,
        guildId: "guild-1",
        userOptions: [user],
        handleInputs: [],
      })
    ).toBeNull();
  });
});
