import type { ChatInputCommandInteraction } from "discord.js";

import { contestCommand } from "../../src/commands/contest.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (query: string, scope?: string | null) =>
  ({
    options: {
      getString: jest.fn((name: string) => {
        if (name === "query") {
          return query;
        }
        if (name === "scope") {
          return scope ?? null;
        }
        return null;
      }),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("contestCommand", () => {
  it("shows contest details for an id", async () => {
    const interaction = createInteraction("1234");
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getLastRefreshAt: jest.fn().mockReturnValue(1),
          getContestById: jest.fn().mockReturnValue({
            id: 1234,
            name: "Codeforces Round #1234",
            phase: "BEFORE",
            startTimeSeconds: 1_700_000_000,
            durationSeconds: 7200,
          }),
          searchContests: jest.fn().mockReturnValue([]),
        },
      },
    } as unknown as CommandContext;

    await contestCommand.execute(interaction, context);

    expect(context.services.contests.getContestById).toHaveBeenCalledWith(1234, "official");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toContain("Codeforces Round #1234");
  });

  it("lists matching contests for name queries", async () => {
    const interaction = createInteraction("Div. 2");
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
      },
    } as unknown as CommandContext;

    await contestCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toBe("Contest matches");
    expect(embed.description).toContain("Codeforces Round #900");
    expect(embed.description).toContain("ID 900");
  });
});
