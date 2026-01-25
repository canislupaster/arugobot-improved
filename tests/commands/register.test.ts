import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

import { registerCommand, relinkCommand, unlinkCommand } from "../../src/commands/register.js";
import type { CommandContext } from "../../src/types/commandContext.js";

type MockInteraction = ChatInputCommandInteraction & {
  deferReply: jest.Mock;
  editReply: jest.Mock;
  reply: jest.Mock;
};

const createInteraction = (overrides: Record<string, unknown> = {}): MockInteraction =>
  ({
    commandName: "register",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getString: jest.fn().mockReturnValue("Petr"),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as MockInteraction;

describe("registerCommand", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("verifies and links a handle", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);

    const interaction = createInteraction();
    const context = {
      correlationId: "corr-1",
      services: {
        problems: {
          ensureProblemsLoaded: jest
            .fn()
            .mockResolvedValue([
              { contestId: 1000, index: "A", name: "Test", rating: 800, tags: [] },
            ]),
        },
        codeforces: {
          request: jest.fn().mockResolvedValue([
            {
              verdict: "COMPILATION_ERROR",
              contestId: 1000,
              problem: { contestId: 1000, index: "A" },
              creationTimeSeconds: 1001,
            },
          ]),
        },
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Petr",
            source: "api",
          }),
          handleExists: jest.fn().mockResolvedValue(false),
          handleLinked: jest.fn().mockResolvedValue(false),
          insertUser: jest.fn().mockResolvedValue("ok"),
        },
      },
    } as unknown as CommandContext;

    await registerCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(context.services.store.insertUser).toHaveBeenCalledWith("guild-1", "user-1", "Petr");
    expect(interaction.editReply).toHaveBeenLastCalledWith("Handle set to Petr.");
  });

  it("rejects invalid handles", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-2",
      services: {
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: false,
            canonicalHandle: null,
            source: "api",
          }),
        },
      },
    } as unknown as CommandContext;

    await registerCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Invalid handle.");
  });
});

describe("unlinkCommand", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects unlink when no handle is linked", async () => {
    const interaction = createInteraction({ commandName: "unlink" });
    const context = {
      correlationId: "corr-3",
      services: {
        store: {
          handleLinked: jest.fn().mockResolvedValue(false),
        },
      },
    } as unknown as CommandContext;

    await unlinkCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "You have not linked a handle.",
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe("relinkCommand", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects relink when no handle is linked", async () => {
    const interaction = createInteraction({ commandName: "relink" });
    const context = {
      correlationId: "corr-4",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await relinkCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "You do not have a linked handle yet. Use /register first.",
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it("rejects relink when handle is unchanged", async () => {
    const interaction = createInteraction({
      commandName: "relink",
      options: {
        getString: jest.fn().mockReturnValue("Petr"),
      },
    });
    const context = {
      correlationId: "corr-5",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue("Petr"),
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Petr",
            source: "api",
          }),
        },
      },
    } as unknown as CommandContext;

    await relinkCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      "That handle is already linked to your account."
    );
  });
});
