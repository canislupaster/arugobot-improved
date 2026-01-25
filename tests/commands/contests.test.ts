import type { ChatInputCommandInteraction } from "discord.js";

import { contestsCommand } from "../../src/commands/contests.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (options: { scope?: string | null } = {}) =>
  ({
    options: {
      getInteger: jest.fn().mockReturnValue(null),
      getString: jest.fn((name: string) => {
        if (name === "include") {
          return "div. 2";
        }
        if (name === "exclude") {
          return "kotlin";
        }
        if (name === "scope") {
          return options.scope ?? null;
        }
        return null;
      }),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

describe("contestsCommand", () => {
  it("filters contests by include/exclude keywords", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getOngoing: jest.fn().mockReturnValue([
            {
              id: 101,
              name: "Kotlin Heroes: Practice",
              phase: "CODING",
              startTimeSeconds: 1_700_000_000,
              durationSeconds: 7200,
            },
          ]),
          getUpcoming: jest.fn().mockReturnValue([
            {
              id: 102,
              name: "Codeforces Round #900 (Div. 2)",
              phase: "BEFORE",
              startTimeSeconds: 1_700_000_600,
              durationSeconds: 7200,
            },
          ]),
          getLastRefreshAt: jest.fn().mockReturnValue(1_700_000_000),
        },
      },
    } as unknown as CommandContext;

    await contestsCommand.execute(interaction, context);

    expect(context.services.contests.getOngoing).toHaveBeenCalledWith("official");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const fields = payload.embeds[0].data.fields ?? [];
    const fieldText = JSON.stringify(fields);
    expect(fieldText).toContain("Codeforces Round #900");
    expect(fieldText).not.toContain("Kotlin Heroes");
  });

  it("uses the gym scope when requested", async () => {
    const interaction = createInteraction({ scope: "gym" });
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getOngoing: jest.fn().mockReturnValue([]),
          getUpcoming: jest.fn().mockReturnValue([]),
          getLastRefreshAt: jest.fn().mockReturnValue(1_700_000_000),
        },
      },
    } as unknown as CommandContext;

    await contestsCommand.execute(interaction, context);

    expect(context.services.contests.refresh).toHaveBeenCalledWith(false, "gym");
    expect(context.services.contests.getUpcoming).toHaveBeenCalledWith(5, "gym");
  });
});
