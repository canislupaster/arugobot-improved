import type { ChatInputCommandInteraction } from "discord.js";

import { problemCommand } from "../../src/commands/problem.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    options: {
      getString: jest.fn().mockReturnValue("1000A"),
    },
    user: { id: "user-1" },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    guild: {
      id: "guild-1",
      members: {
        fetch: jest.fn().mockResolvedValue(
          new Map([["user-1", { user: { id: "user-1" } }]])
        ),
        cache: new Map([["user-1", { user: { id: "user-1" } }]]),
      },
    },
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("problemCommand", () => {
  it("rejects invalid references", async () => {
    const interaction = createInteraction({
      options: { getString: jest.fn().mockReturnValue("bad input") },
    });
    const context = {} as CommandContext;

    await problemCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Invalid problem reference. Use an id like 1000A or a Codeforces URL.",
    });
  });

  it("handles missing problems", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-1",
      services: {
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([{}]),
          getProblemDict: jest.fn().mockReturnValue(new Map()),
        },
        store: {
          getLinkedUsers: jest.fn().mockResolvedValue([]),
          getContestSolvesResult: jest.fn().mockResolvedValue({
            solves: [],
            source: "cache",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await problemCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      "Problem not found in the cache. Double-check the id."
    );
  });

  it("renders problem details with solved summary", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-2",
      services: {
        problems: {
          ensureProblemsLoaded: jest
            .fn()
            .mockResolvedValue([
              { contestId: 1000, index: "A", name: "Test", rating: 800, tags: [] },
            ]),
          getProblemDict: jest
            .fn()
            .mockReturnValue(
              new Map([
                ["1000A", { contestId: 1000, index: "A", name: "Test", rating: 800, tags: [] }],
              ])
            ),
        },
        store: {
          getLinkedUsers: jest.fn().mockResolvedValue([{ userId: "user-1", handle: "tourist" }]),
          getContestSolvesResult: jest.fn().mockResolvedValue({
            solves: [
              {
                id: 101,
                handle: "tourist",
                contestId: 1000,
                index: "A",
                creationTimeSeconds: 1000,
              },
            ],
            source: "cache",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await problemCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.any(Object)],
      })
    );
  });
});
