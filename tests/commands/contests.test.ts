import type { ChatInputCommandInteraction } from "discord.js";

import { contestsCommand } from "../../src/commands/contests.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    options: {
      getInteger: jest.fn().mockReturnValue(null),
      getString: jest.fn()
        .mockReturnValueOnce("div. 2")
        .mockReturnValueOnce("kotlin"),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
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

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const fields = payload.embeds[0].data.fields ?? [];
    const fieldText = JSON.stringify(fields);
    expect(fieldText).toContain("Codeforces Round #900");
    expect(fieldText).not.toContain("Kotlin Heroes");
  });
});
