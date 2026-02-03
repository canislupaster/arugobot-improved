import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

import {
  resolveBoundedIntegerOption,
  resolveHandleTargetLabels,
  resolveHandleTargetLabelsOrReply,
  resolveHandleUserOptions,
  resolvePageOption,
  resolveTargetLabels,
  replyEphemeral,
  requireGuild,
  safeInteractionDefer,
  safeInteractionEdit,
  safeInteractionReply,
  validateHandleTargetContext,
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

  it("replies ephemerally", async () => {
    const interaction = createInteraction();

    await expect(replyEphemeral(interaction as never, "Hi")).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Hi",
      flags: MessageFlags.Ephemeral,
    });
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

describe("requireGuild", () => {
  const createInteraction = (overrides: Record<string, unknown> = {}) =>
    ({
      guild: { id: "guild-1" },
      reply: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    }) as unknown as { guild: { id: string } | null; reply: jest.Mock };

  it("replies and returns null when no guild", async () => {
    const interaction = createInteraction({ guild: null });

    await expect(
      requireGuild(interaction as unknown as ChatInputCommandInteraction, {
        content: "Server only.",
      })
    ).resolves.toBeNull();

    expect(interaction.reply).toHaveBeenCalledWith({ content: "Server only." });
  });

  it("returns the guild when present", async () => {
    const interaction = createInteraction();

    await expect(
      requireGuild(interaction as unknown as ChatInputCommandInteraction, {
        content: "Server only.",
      })
    ).resolves.toEqual({ id: "guild-1" });

    expect(interaction.reply).not.toHaveBeenCalled();
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

describe("resolveHandleTargetLabels", () => {
  const createInteraction = (overrides: Record<string, unknown> = {}) =>
    ({
      options: {
        getString: jest.fn().mockReturnValue(null),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
      },
      user: { id: "user-1", username: "Aru", toString: () => "<@1>" },
      guild: { id: "guild-1" },
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

    const result = resolveHandleTargetLabels(interaction);

    expect(result).toEqual({ status: "error", error: "Provide either a handle or a user, not both." });
  });

  it("returns custom DM errors", () => {
    const interaction = createInteraction({ guild: null });

    const result = resolveHandleTargetLabels(interaction, {
      contextMessages: {
        missingHandleInDm: "Custom handle needed.",
      },
    });

    expect(result).toEqual({ status: "error", error: "Custom handle needed." });
  });

  it("returns labels and user info on success", () => {
    const interaction = createInteraction({
      options: {
        getString: jest.fn().mockReturnValue(""),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue({ displayName: "Nickname", toString: () => "<@!1>" }),
      },
    });

    const result = resolveHandleTargetLabels(interaction);

    expect(result).toEqual({
      status: "ok",
      handleInput: "",
      userOption: null,
      member: { displayName: "Nickname", toString: expect.any(Function) },
      user: { id: "user-1", username: "Aru", toString: expect.any(Function) },
      targetId: "user-1",
      labels: { displayName: "Nickname", mention: "<@!1>" },
    });
  });
});

describe("resolvePageOption", () => {
  const createInteraction = (value: number | null) =>
    ({
      options: {
        getInteger: jest.fn().mockReturnValue(value),
      },
    }) as never;

  it("uses default value when option is missing", () => {
    const interaction = createInteraction(null);

    const result = resolvePageOption(interaction);

    expect(result).toEqual({ value: 1 });
  });

  it("returns an error when below the minimum", () => {
    const interaction = createInteraction(0);

    const result = resolvePageOption(interaction);

    expect(result).toEqual({ error: "Invalid page." });
  });

  it("respects a custom max value", () => {
    const interaction = createInteraction(3);

    const result = resolvePageOption(interaction, { max: 2 });

    expect(result).toEqual({ error: "Invalid page." });
  });
});

describe("resolveHandleTargetLabelsOrReply", () => {
  const createInteraction = (overrides: Record<string, unknown> = {}) =>
    ({
      options: {
        getString: jest.fn().mockReturnValue(null),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
      },
      deferred: false,
      replied: false,
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
      user: { id: "user-1", username: "Aru", toString: () => "<@1>" },
      guild: { id: "guild-1" },
      ...overrides,
    }) as never;

  it("replies with errors and returns replied status", async () => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const interaction = createInteraction({
      reply,
      options: {
        getString: jest.fn().mockReturnValue("tourist"),
        getUser: jest.fn().mockReturnValue({ id: "user-2" }),
        getMember: jest.fn().mockReturnValue(null),
      },
    });

    const result = await resolveHandleTargetLabelsOrReply(interaction);

    expect(reply).toHaveBeenCalledWith({
      content: "Provide either a handle or a user, not both.",
    });
    expect(result).toEqual({ status: "replied" });
  });

  it("follows up when the interaction was already deferred", async () => {
    const followUp = jest.fn().mockResolvedValue(undefined);
    const reply = jest.fn().mockResolvedValue(undefined);
    const interaction = createInteraction({
      deferred: true,
      followUp,
      reply,
      options: {
        getString: jest.fn().mockReturnValue("tourist"),
        getUser: jest.fn().mockReturnValue({ id: "user-2" }),
        getMember: jest.fn().mockReturnValue(null),
      },
    });

    const result = await resolveHandleTargetLabelsOrReply(interaction);

    expect(followUp).toHaveBeenCalledWith({
      content: "Provide either a handle or a user, not both.",
    });
    expect(reply).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "replied" });
  });

  it("returns labels on success without replying", async () => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const interaction = createInteraction({
      reply,
      options: {
        getString: jest.fn().mockReturnValue(""),
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
      },
    });

    const result = await resolveHandleTargetLabelsOrReply(interaction);

    expect(reply).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
  });
});

describe("validateHandleTargetContext", () => {
  const createInteraction = (guild: object | null) => ({ guild }) as never;

  it("blocks user mentions in DMs", () => {
    const interaction = createInteraction(null);
    const error = validateHandleTargetContext(interaction, "tourist", { id: "user-1" } as never);

    expect(error).toBe("This command can only target other users in a server.");
  });

  it("requires a handle in DMs when user is missing", () => {
    const interaction = createInteraction(null);
    const error = validateHandleTargetContext(interaction, "", null);

    expect(error).toBe("Provide a handle when using this command in DMs.");
  });

  it("allows handles in DMs", () => {
    const interaction = createInteraction(null);
    const error = validateHandleTargetContext(interaction, "tourist", null);

    expect(error).toBeNull();
  });

  it("allows user targets in guilds", () => {
    const interaction = createInteraction({ id: "guild-1" });
    const error = validateHandleTargetContext(interaction, "", { id: "user-1" } as never);

    expect(error).toBeNull();
  });

  it("supports custom DM messages", () => {
    const interaction = createInteraction(null);
    const error = validateHandleTargetContext(interaction, "", { id: "user-1" } as never, {
      userInDm: "Custom user message.",
      missingHandleInDm: "Custom handle message.",
    });

    expect(error).toBe("Custom user message.");
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
