import type { ChatInputCommandInteraction } from "discord.js";

import { contestResultsCommand } from "../../src/commands/contestResults.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (query: string, handles?: string) =>
  ({
    options: {
      getString: jest.fn((name: string) => {
        if (name === "query") {
          return query;
        }
        if (name === "handles") {
          return handles ?? null;
        }
        return null;
      }),
      getInteger: jest.fn().mockReturnValue(null),
      getUser: jest.fn().mockReturnValue(null),
    },
    guild: { id: "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("contestResultsCommand", () => {
  it("renders standings for linked users", async () => {
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
        store: {
          getLinkedUsers: jest.fn().mockResolvedValue([
            { userId: "user-1", handle: "tourist" },
            { userId: "user-2", handle: "petr" },
          ]),
          getHandle: jest.fn(),
          resolveHandle: jest.fn(),
        },
        contestStandings: {
          getStandings: jest.fn().mockResolvedValue({
            entries: [
              {
                handle: "tourist",
                rank: 1,
                points: 100,
                penalty: 0,
                participantType: "CONTESTANT",
              },
              {
                handle: "petr",
                rank: 2,
                points: 95,
                penalty: 10,
                participantType: "VIRTUAL",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await contestResultsCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toContain("Contest results");
    const standingsField = embed.fields?.find(
      (field: { name: string; value: string }) => field.name === "Standings"
    );
    expect(standingsField?.value).toContain("tourist");
    expect(standingsField?.value).toContain("petr");
  });

  it("lists contest matches when multiple contests are found", async () => {
    const interaction = createInteraction("Div. 2", "tourist");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue(null),
          searchContests: jest.fn().mockReturnValue([
            {
              id: 900,
              name: "Codeforces Round #900 (Div. 2)",
              phase: "BEFORE",
              startTimeSeconds: 1_700_000_000,
              durationSeconds: 7200,
            },
            {
              id: 850,
              name: "Codeforces Round #850 (Div. 2)",
              phase: "FINISHED",
              startTimeSeconds: 1_600_000_000,
              durationSeconds: 7200,
            },
          ]),
        },
        store: {
          resolveHandle: jest.fn().mockResolvedValue({ exists: true, canonicalHandle: "tourist" }),
        },
        contestStandings: {
          getStandings: jest.fn(),
        },
      },
    } as unknown as CommandContext;

    await contestResultsCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Contest matches");
    expect(context.services.contestStandings.getStandings).not.toHaveBeenCalled();
  });
});
