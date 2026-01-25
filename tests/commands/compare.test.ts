import type { ChatInputCommandInteraction } from "discord.js";

import { compareCommand } from "../../src/commands/compare.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}): ChatInputCommandInteraction =>
  ({
    commandName: "compare",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getUser: jest
        .fn()
        .mockImplementation((name: string) =>
          name === "user1" ? { id: "user-2", username: "Other" } : null
        ),
      getString: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("compareCommand", () => {
  it("defaults to the invoking user and reports missing handle", async () => {
    const interaction = createInteraction({
      options: {
        getUser: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    const context = {
      correlationId: "corr-1",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await compareCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "User <@user-1> does not have a linked handle."
    );
  });

  it("rejects invalid handles", async () => {
    const interaction = createInteraction({
      options: {
        getUser: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue("bad_handle"),
      },
    });
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

    await compareCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Invalid handle: bad_handle");
  });

  it("renders comparison for users and handles", async () => {
    const interaction = createInteraction({
      options: {
        getUser: jest
          .fn()
          .mockImplementation((name: string) =>
            name === "user1" ? { id: "user-2", username: "Other" } : null
          ),
        getString: jest.fn().mockReturnValue("petr"),
      },
    });
    const context = {
      correlationId: "corr-3",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue("tourist"),
          getRating: jest.fn().mockResolvedValue(1600),
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Petr",
            source: "api",
          }),
          getCodeforcesProfile: jest.fn().mockResolvedValue({
            profile: {
              handle: "tourist",
              displayHandle: "tourist",
              rating: 3000,
              rank: "legendary grandmaster",
              maxRating: 3100,
              maxRank: "legendary grandmaster",
              lastOnlineTimeSeconds: 123,
              lastFetched: new Date().toISOString(),
            },
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await compareCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const fields = payload.embeds[0].data.fields as Array<{ name: string; value: string }>;
    const fieldValues = fields.map((field) => field.value);
    const fieldNames = fields.map((field) => field.name);
    expect(fieldValues.join("\n")).toContain("Handle: tourist");
    expect(fieldValues.join("\n")).toContain("Handle: Petr");
    expect(fieldNames.join("\n")).not.toContain("<@");
  });

  it("dedupes handles across users and handle inputs", async () => {
    const interaction = createInteraction({
      options: {
        getUser: jest
          .fn()
          .mockImplementation((name: string) =>
            name === "user1" ? { id: "user-2", username: "Other" } : null
          ),
        getString: jest.fn().mockReturnValue("tourist"),
      },
    });
    const context = {
      correlationId: "corr-4",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue("Tourist"),
          getRating: jest.fn().mockResolvedValue(1600),
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "tourist",
            source: "api",
          }),
          getCodeforcesProfile: jest.fn().mockResolvedValue({
            profile: {
              handle: "tourist",
              displayHandle: "tourist",
              rating: 3000,
              rank: "legendary grandmaster",
              maxRating: 3100,
              maxRank: "legendary grandmaster",
              lastOnlineTimeSeconds: 123,
              lastFetched: new Date().toISOString(),
            },
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await compareCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const fields = payload.embeds[0].data.fields as Array<{ name: string }>;
    expect(fields).toHaveLength(1);
  });
});
