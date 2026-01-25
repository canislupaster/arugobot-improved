import type { ChatInputCommandInteraction } from "discord.js";

import { contestUpsolveCommand } from "../../src/commands/contestUpsolve.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (query: string, handle?: string, limit?: number) =>
  ({
    commandName: "contestupsolve",
    options: {
      getString: jest.fn((name: string) => {
        if (name === "query") {
          return query;
        }
        if (name === "handle") {
          return handle ?? null;
        }
        if (name === "scope") {
          return null;
        }
        return null;
      }),
      getInteger: jest.fn((name: string) => {
        if (name === "limit") {
          return limit ?? null;
        }
        return null;
      }),
      getUser: jest.fn(() => null),
      getMember: jest.fn(() => null),
    },
    user: {
      id: "user-1",
      username: "Alice",
      toString: () => "<@user-1>",
    },
    guild: { id: "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("contestUpsolveCommand", () => {
  it("renders an unsolved list for the linked handle", async () => {
    const interaction = createInteraction("1234");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Round #1234",
            phase: "FINISHED",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([
            {
              contestId: 1234,
              index: "A",
              name: "Problem A",
              rating: 800,
              tags: [],
            },
            {
              contestId: 1234,
              index: "B",
              name: "Problem B",
              rating: 900,
              tags: [],
            },
          ]),
        },
        store: {
          getHandle: jest.fn().mockResolvedValue("tourist"),
          getContestSolvesResult: jest.fn().mockResolvedValue({
            solves: [
              {
                id: 1,
                handle: "tourist",
                contestId: 1234,
                index: "A",
                creationTimeSeconds: 1_700_000_100,
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestUpsolveCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const unsolvedField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Unsolved problems"
    );
    expect(unsolvedField?.value).toContain("Problem B");
  });

  it("returns a message when the user has no linked handle", async () => {
    const interaction = createInteraction("1234");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Round #1234",
            phase: "FINISHED",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
        problems: {
          ensureProblemsLoaded: jest.fn().mockResolvedValue([
            {
              contestId: 1234,
              index: "A",
              name: "Problem A",
              rating: 800,
              tags: [],
            },
          ]),
        },
        store: {
          getHandle: jest.fn().mockResolvedValue(null),
          getContestSolvesResult: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestUpsolveCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Handle not linked.");
  });
});
