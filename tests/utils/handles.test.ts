import {
  normalizeHandleInput,
  normalizeHandleKey,
  parseHandleList,
  resolveHandleTarget,
  resolveHandleTargetWithOptionalGuild,
} from "../../src/utils/handles.js";

describe("normalizeHandleInput", () => {
  it("extracts a handle from a profile URL", () => {
    expect(normalizeHandleInput("https://codeforces.com/profile/tourist")).toBe("tourist");
  });

  it("extracts a handle from a short profile URL", () => {
    expect(normalizeHandleInput("https://codeforces.com/u/Petr")).toBe("Petr");
  });

  it("handles wrapped links", () => {
    expect(normalizeHandleInput("<https://codeforces.com/profile/Benq>")).toBe("Benq");
  });

  it("leaves plain handles unchanged", () => {
    expect(normalizeHandleInput("  jiangly  ")).toBe("jiangly");
  });
});

describe("normalizeHandleKey", () => {
  it("trims and lowercases handles", () => {
    expect(normalizeHandleKey("  ToURiSt ")).toBe("tourist");
  });

  it("returns an empty string for whitespace", () => {
    expect(normalizeHandleKey("   ")).toBe("");
  });
});

describe("parseHandleList", () => {
  it("splits handles by comma and whitespace", () => {
    expect(parseHandleList("tourist,  petr\nneal")).toEqual(["tourist", "petr", "neal"]);
  });

  it("normalizes profile URLs in handle lists", () => {
    expect(
      parseHandleList("https://codeforces.com/profile/tourist, https://codeforces.com/u/Petr")
    ).toEqual(["tourist", "Petr"]);
  });

  it("returns an empty array for whitespace", () => {
    expect(parseHandleList("   ")).toEqual([]);
  });
});

describe("resolveHandleTarget", () => {
  it("rejects invalid handle input", async () => {
    const store = {
      resolveHandle: jest.fn(async () => ({ exists: false })),
      getHandle: jest.fn(async () => null),
    };

    await expect(
      resolveHandleTarget(store, {
        guildId: "guild",
        targetId: "user",
        handleInput: "invalid",
      })
    ).resolves.toEqual({ error: "Invalid handle." });
  });

  it("returns the canonical handle with no linked user when provided", async () => {
    const store = {
      resolveHandle: jest.fn(async () => ({ exists: true, canonicalHandle: "Tourist" })),
      getHandle: jest.fn(async () => null),
    };

    await expect(
      resolveHandleTarget(store, {
        guildId: "guild",
        targetId: "user",
        handleInput: "tourist",
      })
    ).resolves.toEqual({ handle: "Tourist", linkedUserId: null });
  });

  it("loads the linked user id when requested", async () => {
    const store = {
      resolveHandle: jest.fn(async () => ({ exists: true, canonicalHandle: "Petr" })),
      getHandle: jest.fn(async () => null),
      getUserIdByHandle: jest.fn(async () => "user-123"),
    };

    await expect(
      resolveHandleTarget(store, {
        guildId: "guild",
        targetId: "user",
        handleInput: "Petr",
        includeLinkedUserId: true,
      })
    ).resolves.toEqual({ handle: "Petr", linkedUserId: "user-123" });
  });

  it("returns linked handle for the target user", async () => {
    const store = {
      resolveHandle: jest.fn(async () => ({ exists: true })),
      getHandle: jest.fn(async () => "neal"),
    };

    await expect(
      resolveHandleTarget(store, {
        guildId: "guild",
        targetId: "user-42",
        handleInput: "",
      })
    ).resolves.toEqual({ handle: "neal", linkedUserId: "user-42" });
  });

  it("rejects when the target user has no linked handle", async () => {
    const store = {
      resolveHandle: jest.fn(async () => ({ exists: true })),
      getHandle: jest.fn(async () => null),
    };

    await expect(
      resolveHandleTarget(store, {
        guildId: "guild",
        targetId: "user-42",
        handleInput: "",
      })
    ).resolves.toEqual({ error: "Handle not linked." });
  });
});

describe("resolveHandleTargetWithOptionalGuild", () => {
  it("requires a handle when there is no guild", async () => {
    const store = {
      resolveHandle: jest.fn(async () => ({ exists: true })),
      getHandle: jest.fn(async () => null),
    };

    await expect(
      resolveHandleTargetWithOptionalGuild(store, {
        guildId: null,
        targetId: "user",
        handleInput: "",
      })
    ).resolves.toEqual({ error: "Provide a handle when using this command in DMs." });
  });

  it("resolves a handle without a guild", async () => {
    const store = {
      resolveHandle: jest.fn(async () => ({ exists: true, canonicalHandle: "Tourist" })),
      getHandle: jest.fn(async () => null),
    };

    await expect(
      resolveHandleTargetWithOptionalGuild(store, {
        guildId: null,
        targetId: "user",
        handleInput: "tourist",
      })
    ).resolves.toEqual({ handle: "Tourist", linkedUserId: null });
  });

  it("delegates to resolveHandleTarget when a guild is present", async () => {
    const store = {
      resolveHandle: jest.fn(async () => ({ exists: true })),
      getHandle: jest.fn(async () => "neal"),
    };

    await expect(
      resolveHandleTargetWithOptionalGuild(store, {
        guildId: "guild",
        targetId: "user-42",
        handleInput: "",
      })
    ).resolves.toEqual({ handle: "neal", linkedUserId: "user-42" });
  });
});
