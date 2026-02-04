import {
  CONTEST_ACTIVITY_DEFAULTS,
  buildContestActivityOptionConfig,
  resolveContestActivityContextOrReply,
  resolveContestActivityRosterContextOrReply,
  resolveContestActivityOptionsOrReply,
} from "../../src/utils/contestActivityOptions.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    options: {
      getInteger: jest.fn().mockReturnValue(null),
      getString: jest.fn().mockReturnValue(null),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as Parameters<typeof resolveContestActivityOptionsOrReply>[0];

const createContextInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    options: {
      getInteger: jest.fn().mockReturnValue(null),
      getString: jest.fn().mockReturnValue(null),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    guild: { id: "guild-1" },
    ...overrides,
  }) as unknown as Parameters<typeof resolveContestActivityContextOrReply>[0];

const createRosterInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    options: {
      getInteger: jest.fn().mockReturnValue(null),
      getString: jest.fn().mockReturnValue(null),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    commandName: "contestactivity",
    user: { id: "user-1" },
    guild: { id: "guild-1" },
    ...overrides,
  }) as unknown as Parameters<typeof resolveContestActivityRosterContextOrReply>[0];

describe("resolveContestActivityOptionsOrReply", () => {
  it("returns defaults when options are omitted", async () => {
    const interaction = createInteraction();
    const config = buildContestActivityOptionConfig({
      daysErrorMessage: "Invalid lookback window.",
      limitErrorMessage: "Invalid limit.",
    });

    const result = await resolveContestActivityOptionsOrReply(interaction, config);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.days).toBe(CONTEST_ACTIVITY_DEFAULTS.defaultDays);
      expect(result.limit).toBe(CONTEST_ACTIVITY_DEFAULTS.defaultLimit);
      expect(result.scope).toBe(CONTEST_ACTIVITY_DEFAULTS.defaultScope);
    }
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("replies on invalid days", async () => {
    const interaction = createInteraction({
      options: {
        getInteger: jest.fn().mockReturnValue(CONTEST_ACTIVITY_DEFAULTS.maxDays + 1),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const config = buildContestActivityOptionConfig({
      daysErrorMessage: "Invalid lookback window.",
      limitErrorMessage: "Invalid limit.",
    });

    const result = await resolveContestActivityOptionsOrReply(interaction, config);

    expect(result.status).toBe("replied");
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Invalid lookback window.",
    });
  });
});

describe("resolveContestActivityContextOrReply", () => {
  it("replies when used outside a guild", async () => {
    const interaction = createContextInteraction({ guild: null });
    const config = buildContestActivityOptionConfig({
      daysErrorMessage: "Invalid lookback window.",
      limitErrorMessage: "Invalid limit.",
    });

    const result = await resolveContestActivityContextOrReply(interaction, config, {
      guildMessage: "Server only.",
    });

    expect(result.status).toBe("replied");
    expect(interaction.reply).toHaveBeenCalledWith({ content: "Server only." });
  });

  it("returns guild and defaults when ok", async () => {
    const interaction = createContextInteraction({ guild: { id: "guild-2" } });
    const config = buildContestActivityOptionConfig({
      daysErrorMessage: "Invalid lookback window.",
      limitErrorMessage: "Invalid limit.",
    });

    const result = await resolveContestActivityContextOrReply(interaction, config, {
      guildMessage: "Server only.",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.guild.id).toBe("guild-2");
      expect(result.days).toBe(CONTEST_ACTIVITY_DEFAULTS.defaultDays);
      expect(result.limit).toBe(CONTEST_ACTIVITY_DEFAULTS.defaultLimit);
      expect(result.scope).toBe(CONTEST_ACTIVITY_DEFAULTS.defaultScope);
    }
  });
});

describe("resolveContestActivityRosterContextOrReply", () => {
  it("replies when roster is empty", async () => {
    const interaction = createRosterInteraction();
    const config = buildContestActivityOptionConfig({
      daysErrorMessage: "Invalid lookback window.",
      limitErrorMessage: "Invalid limit.",
    });

    const result = await resolveContestActivityRosterContextOrReply(interaction, config, {
      guildMessage: "Server only.",
      store: {
        getServerRoster: jest.fn().mockResolvedValue([]),
      },
    });

    expect(result.status).toBe("replied");
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      "No linked handles yet. Use /register to link a Codeforces handle."
    );
  });

  it("returns roster context when resolved", async () => {
    const members = new Map([
      ["user-1", { user: { id: "user-1" }, toString: () => "<@user-1>" }],
    ]);
    const interaction = createRosterInteraction({
      guild: {
        id: "guild-1",
        members: {
          fetch: jest.fn().mockResolvedValue(members),
          cache: new Map(),
        },
      },
    });
    const config = buildContestActivityOptionConfig({
      daysErrorMessage: "Invalid lookback window.",
      limitErrorMessage: "Invalid limit.",
    });

    const result = await resolveContestActivityRosterContextOrReply(interaction, config, {
      guildMessage: "Server only.",
      store: {
        getServerRoster: jest.fn().mockResolvedValue([
          { userId: "user-1", handle: "tourist" },
        ]),
      },
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.guild.id).toBe("guild-1");
      expect(result.roster).toEqual([{ userId: "user-1", handle: "tourist" }]);
      expect(result.excludedCount).toBe(0);
      expect(result.days).toBe(CONTEST_ACTIVITY_DEFAULTS.defaultDays);
      expect(result.limit).toBe(CONTEST_ACTIVITY_DEFAULTS.defaultLimit);
      expect(result.scope).toBe(CONTEST_ACTIVITY_DEFAULTS.defaultScope);
    }
  });
});
