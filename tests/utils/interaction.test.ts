import {
  resolveBoundedIntegerOption,
  resolveHandleUserOptions,
  resolveTargetLabels,
  safeInteractionDefer,
  safeInteractionEdit,
  safeInteractionReply,
} from "../../src/utils/interaction.js";

type FakeUser = { username: string; toString: () => string };

describe("resolveTargetLabels", () => {
  const user: FakeUser = {
    username: "Aru",
    toString: () => "<@123>",
  };

  it("uses member display name and mention when available", () => {
    const member = {
      displayName: "Nickname",
      toString: () => "<@!123>",
    };

    expect(resolveTargetLabels(user as never, member)).toEqual({
      displayName: "Nickname",
      mention: "<@!123>",
    });
  });

  it("falls back to user mention when member has no toString", () => {
    const member = { displayName: "Nickname" };

    expect(resolveTargetLabels(user as never, member)).toEqual({
      displayName: "Nickname",
      mention: "<@123>",
    });
  });

  it("falls back to username when member has no displayName", () => {
    const member = { toString: () => "<@!999>" };

    expect(resolveTargetLabels(user as never, member)).toEqual({
      displayName: "Aru",
      mention: "<@!999>",
    });
  });

  it("falls back to user when member is missing", () => {
    expect(resolveTargetLabels(user as never, null)).toEqual({
      displayName: "Aru",
      mention: "<@123>",
    });
  });
});

describe("safe interaction helpers", () => {
  const createInteraction = (overrides: Record<string, unknown> = {}) =>
    ({
      deferred: false,
      replied: false,
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    }) as unknown as { [key: string]: unknown };

  it("replies directly when not deferred", async () => {
    const interaction = createInteraction();

    await expect(safeInteractionReply(interaction as never, { content: "Hi" })).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith({ content: "Hi" });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("follows up when deferred", async () => {
    const interaction = createInteraction({ deferred: true });

    await expect(safeInteractionReply(interaction as never, { content: "Hi" })).resolves.toBe(true);

    expect(interaction.followUp).toHaveBeenCalledWith({ content: "Hi" });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("returns false for ignorable edit errors", async () => {
    const interaction = createInteraction({
      editReply: jest.fn().mockRejectedValue(new Error("Unknown interaction")),
    });

    await expect(safeInteractionEdit(interaction as never, "Nope")).resolves.toBe(false);

    expect(interaction.editReply).toHaveBeenCalledWith("Nope");
  });

  it("defers replies when not already acknowledged", async () => {
    const interaction = createInteraction();

    await expect(safeInteractionDefer(interaction as never)).resolves.toBe(true);

    expect(interaction.deferReply).toHaveBeenCalledWith(undefined);
  });

  it("returns true without deferring when already replied", async () => {
    const interaction = createInteraction({ replied: true });

    await expect(safeInteractionDefer(interaction as never)).resolves.toBe(true);

    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it("returns false for ignorable defer errors", async () => {
    const interaction = createInteraction({
      deferReply: jest.fn().mockRejectedValue(new Error("Interaction has already been acknowledged")),
    });

    await expect(safeInteractionDefer(interaction as never)).resolves.toBe(false);

    expect(interaction.deferReply).toHaveBeenCalled();
  });
});

describe("resolveHandleUserOptions", () => {
  const createInteraction = (overrides: Record<string, unknown> = {}) =>
    ({
      options: {
        getString: jest.fn().mockReturnValue(null),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
      },
      ...overrides,
    }) as never;

  it("returns an error when both handle and user are provided", () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn().mockReturnValue("tourist"),
        getUser: jest.fn().mockReturnValue({ id: "user-2" }),
        getMember: jest.fn().mockReturnValue(null),
      },
    });

    const result = resolveHandleUserOptions(interaction);

    expect(result.error).toBe("Provide either a handle or a user, not both.");
  });

  it("trims handle input and returns user option when present", () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn().mockReturnValue("  tourist "),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
      },
    });

    const result = resolveHandleUserOptions(interaction);

    expect(result.handleInput).toBe("tourist");
    expect(result.userOption).toBeNull();
  });
});

describe("resolveBoundedIntegerOption", () => {
  const createInteraction = (value: number | null) =>
    ({
      options: {
        getInteger: jest.fn().mockReturnValue(value),
      },
    }) as never;

  it("returns default when option is missing", () => {
    const interaction = createInteraction(null);

    const result = resolveBoundedIntegerOption(interaction, {
      name: "limit",
      defaultValue: 10,
      min: 1,
      max: 20,
    });

    expect(result).toEqual({ value: 10 });
  });

  it("rejects values outside the range", () => {
    const interaction = createInteraction(25);

    const result = resolveBoundedIntegerOption(interaction, {
      name: "limit",
      defaultValue: 10,
      min: 1,
      max: 20,
      errorMessage: "Invalid limit.",
    });

    expect(result).toEqual({ error: "Invalid limit." });
  });

  it("accepts values within the range", () => {
    const interaction = createInteraction(5);

    const result = resolveBoundedIntegerOption(interaction, {
      name: "limit",
      defaultValue: 10,
      min: 1,
      max: 20,
    });

    expect(result).toEqual({ value: 5 });
  });
});
