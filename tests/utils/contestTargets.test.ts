import type { ChatInputCommandInteraction, Guild, User } from "discord.js";

import {
  getContestUserOptions,
  getContestTargetContextError,
  resolveContestTargetInputsOrReply,
  resolveContestTargets,
  resolveContestTargetsFromInteractionOrReply,
  resolveContestTargetsOrReply,
  validateContestTargetContextOrReply,
} from "../../src/utils/contestTargets.js";

describe("getContestUserOptions", () => {
  it("collects user options and drops missing entries", () => {
    const getUser = jest.fn((name: string) => {
      if (name === "user1") {
        return { id: "user-1" } as User;
      }
      if (name === "user3") {
        return { id: "user-3" } as User;
      }
      return null;
    });
    const interaction = {
      options: { getUser },
    } as unknown as ChatInputCommandInteraction;

    expect(getContestUserOptions(interaction)).toEqual([
      { id: "user-1" },
      { id: "user-3" },
    ]);
    expect(getUser).toHaveBeenCalledWith("user1");
    expect(getUser).toHaveBeenCalledWith("user2");
    expect(getUser).toHaveBeenCalledWith("user3");
    expect(getUser).toHaveBeenCalledWith("user4");
  });
});

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

  it("returns the first invalid handle in input order", async () => {
    const store = {
      getHandle: jest.fn(),
      resolveHandle: jest.fn(async (handle: string) => {
        if (handle === "bad") {
          return { exists: false, canonicalHandle: null };
        }
        return { exists: true, canonicalHandle: "tourist" };
      }),
      getLinkedUsers: jest.fn(),
    };

    const result = await resolveContestTargets({
      ...baseParams,
      userOptions: [],
      handleInputs: ["bad", "tourist"],
      store,
    });

    expect(result).toEqual({ status: "error", message: "Invalid handle: bad" });
  });

  it("stops resolving handles after the first invalid entry", async () => {
    const resolveHandle = jest.fn(async (handle: string) => {
      if (handle === "bad") {
        return { exists: false, canonicalHandle: null };
      }
      if (handle === "later") {
        throw new Error("Should not resolve later handles after a failure.");
      }
      return { exists: true, canonicalHandle: "tourist" };
    });
    const store = {
      getHandle: jest.fn(),
      resolveHandle,
      getLinkedUsers: jest.fn(),
    };

    const result = await resolveContestTargets({
      ...baseParams,
      userOptions: [],
      handleInputs: ["bad", "later"],
      store,
    });

    expect(result).toEqual({ status: "error", message: "Invalid handle: bad" });
    expect(resolveHandle).toHaveBeenCalledTimes(1);
    expect(resolveHandle).toHaveBeenCalledWith("bad");
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
      message: "No linked handles yet. Use /register to link a Codeforces handle.",
    });
  });

  it("returns an error when no current members are linked", async () => {
    const store = {
      getHandle: jest.fn(),
      resolveHandle: jest.fn(),
      getLinkedUsers: jest.fn().mockResolvedValue([{ userId: "user-2", handle: "tourist" }]),
    };
    const guild = {
      id: "guild-1",
      members: {
        fetch: jest.fn().mockResolvedValue(new Map()),
        cache: new Map(),
      },
    } as unknown as Guild;

    const result = await resolveContestTargets({
      ...baseParams,
      guild,
      userOptions: [],
      handleInputs: [],
      store,
    });

    expect(result).toEqual({
      status: "error",
      message: "No linked handles found for current server members. Use /handles to review linked accounts.",
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

  it("enforces max linked handle limits for guild rosters", async () => {
    const store = {
      getHandle: jest.fn(),
      resolveHandle: jest.fn(),
      getLinkedUsers: jest.fn().mockResolvedValue([
        { userId: "user-2", handle: "tourist" },
        { userId: "user-3", handle: "petr" },
      ]),
    };
    const guild = {
      id: "guild-1",
      members: {
        fetch: jest.fn().mockResolvedValue(
          new Map([
            ["user-2", { user: { id: "user-2" } }],
            ["user-3", { user: { id: "user-3" } }],
          ])
        ),
        cache: new Map(),
      },
    } as unknown as Guild;

    const result = await resolveContestTargets({
      ...baseParams,
      guild,
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

  it("dedupes handle inputs before resolving", async () => {
    const resolveHandle = jest
      .fn()
      .mockResolvedValue({ exists: true, canonicalHandle: "tourist" });
    const store = {
      getHandle: jest.fn(),
      resolveHandle,
      getLinkedUsers: jest.fn(),
    };

    const result = await resolveContestTargets({
      ...baseParams,
      userOptions: [],
      handleInputs: [
        "tourist",
        "https://codeforces.com/profile/tourist",
        "@tourist",
      ],
      store,
    });

    expect(result.status).toBe("ok");
    expect(resolveHandle).toHaveBeenCalledTimes(1);
    expect(resolveHandle).toHaveBeenCalledWith("tourist");
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
      "No linked handles yet. Use /register to link a Codeforces handle."
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

  it("uses interaction context when resolving contest targets", async () => {
    const store = {
      getHandle: jest.fn(),
      resolveHandle: jest.fn(),
      getLinkedUsers: jest.fn(),
    };
    const interaction = {
      guild: null,
      guildId: null,
      user: { id: "user-1" },
      commandName: "contestresults",
      editReply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    const result = await resolveContestTargetsFromInteractionOrReply({
      interaction,
      userOptions: [],
      handleInputs: [],
      correlationId: "corr-1",
      store,
    });

    expect(result).toEqual({ status: "replied" });
    expect(interaction.editReply).toHaveBeenCalledWith(
      "Provide at least one handle or run this command in a server."
    );
  });
});

describe("resolveContestTargetInputsOrReply", () => {
  it("replies when no guild and no handles are provided", async () => {
    const reply = jest.fn();
    const interaction = {
      guild: null,
      options: {
        getUser: jest.fn(),
      },
      reply,
    } as unknown as ChatInputCommandInteraction;

    const result = await resolveContestTargetInputsOrReply(interaction, " ");

    expect(result).toEqual({ status: "replied" });
    expect(reply).toHaveBeenCalledWith({
      content: "Provide at least one handle or run this command in a server.",
    });
  });

  it("returns handles and user options when valid", async () => {
    const getUser = jest.fn(() => null);
    const interaction = {
      guild: null,
      options: { getUser },
      reply: jest.fn(),
    } as unknown as ChatInputCommandInteraction;

    const result = await resolveContestTargetInputsOrReply(
      interaction,
      " tourist, https://codeforces.com/profile/petr "
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.handleInputs).toEqual(["tourist", "petr"]);
      expect(result.userOptions).toEqual([]);
    }
  });
});

describe("validateContestTargetContextOrReply", () => {
  it("replies when context is invalid", async () => {
    const reply = jest.fn().mockResolvedValue(undefined);

    const result = await validateContestTargetContextOrReply(
      { reply },
      {
        guild: null,
        userOptions: [{ id: "user-1" } as User],
        handleInputs: [],
      }
    );

    expect(result).toEqual({ status: "replied" });
    expect(reply).toHaveBeenCalledWith({
      content: "Specify handles directly when using this command outside a server.",
    });
  });

  it("returns ok when context is valid", async () => {
    const reply = jest.fn().mockResolvedValue(undefined);

    const result = await validateContestTargetContextOrReply(
      { reply },
      {
        guild: null,
        userOptions: [],
        handleInputs: ["tourist"],
      }
    );

    expect(result).toEqual({ status: "ok" });
    expect(reply).not.toHaveBeenCalled();
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
