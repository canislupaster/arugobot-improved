import { normalizeHandleInput, resolveHandleTarget } from "../../src/utils/handles.js";

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
