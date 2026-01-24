import type { ChatInputCommandInteraction } from "discord.js";

import { relinkCommand } from "../../src/commands/register.js";
import type { CommandContext } from "../../src/types/commandContext.js";
import { privateFlags } from "../../src/utils/discordFlags.js";

type MockInteraction = ChatInputCommandInteraction & {
  deferReply: jest.Mock;
  editReply: jest.Mock;
  reply: jest.Mock;
};

const createInteraction = (overrides: Record<string, unknown> = {}): MockInteraction =>
  ({
    commandName: "relink",
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

describe("relinkCommand", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("verifies and updates a linked handle", async () => {
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
          getHandle: jest.fn().mockResolvedValue("tourist"),
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Petr",
            source: "api",
          }),
          handleExists: jest.fn().mockResolvedValue(false),
          updateUserHandle: jest.fn().mockResolvedValue("ok"),
        },
      },
    } as unknown as CommandContext;

    await relinkCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ...privateFlags });
    expect(context.services.store.updateUserHandle).toHaveBeenCalledWith(
      "guild-1",
      "user-1",
      "Petr"
    );
    expect(interaction.editReply).toHaveBeenLastCalledWith("Handle updated to Petr.");
  });

  it("rejects relink when no handle is linked", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-2",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await relinkCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "You do not have a linked handle yet. Use /register first.",
      ...privateFlags,
    });
  });
});
