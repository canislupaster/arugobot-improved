import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

import { handleAdminCommand } from "../../src/commands/handleAdmin.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "handleadmin",
    user: { id: "admin-1" },
    guild: { id: "guild-1" },
    options: {
      getSubcommand: jest.fn().mockReturnValue("set"),
      getUser: jest.fn().mockReturnValue({ id: "user-1" }),
      getString: jest.fn().mockReturnValue("tourist"),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("handleAdminCommand", () => {
  it("links a handle for a new user", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-1",
      services: {
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Tourist",
            source: "api",
          }),
          getHandle: jest.fn().mockResolvedValue(null),
          insertUser: jest.fn().mockResolvedValue("ok"),
        },
      },
    } as unknown as CommandContext;

    await handleAdminCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(context.services.store.insertUser).toHaveBeenCalledWith("guild-1", "user-1", "Tourist");
    expect(interaction.editReply).toHaveBeenCalledWith(
      "Linked handle for <@user-1> set to Tourist."
    );
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

    await handleAdminCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith("Invalid handle.");
  });

  it("reports when unlinking a user with no handle", async () => {
    const interaction = createInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue("unlink"),
        getUser: jest.fn().mockReturnValue({ id: "user-1" }),
        getString: jest.fn(),
      },
    });
    const context = {
      correlationId: "corr-3",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await handleAdminCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith("No handle linked for <@user-1>.");
  });
});
