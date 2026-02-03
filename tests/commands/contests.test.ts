import type { ChatInputCommandInteraction } from "discord.js";

import { contestsCommand } from "../../src/commands/contests.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (
  options: {
    scope?: string | null;
    include?: string | null;
    exclude?: string | null;
    guildId?: string | null;
  } = {}
) =>
  ({
    options: {
      getInteger: jest.fn().mockReturnValue(null),
      getString: jest.fn((name: string) => {
        if (name === "include") {
          return options.include !== undefined ? options.include : "div. 2";
        }
        if (name === "exclude") {
          return options.exclude !== undefined ? options.exclude : "kotlin";
        }
        if (name === "scope") {
          return options.scope ?? null;
        }
        return null;
      }),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    guild: options.guildId ? { id: options.guildId } : null,
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

  it("explains when filters remove all contests", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getOngoing: jest.fn().mockReturnValue([]),
          getUpcoming: jest.fn().mockReturnValue([
            {
              id: 102,
              name: "Kotlin Heroes: Practice",
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

    expect(interaction.editReply).toHaveBeenCalledWith("No contests match the selected filters.");
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

  it("uses default contest filters when no options are provided", async () => {
    const interaction = createInteraction({
      include: null,
      exclude: null,
      scope: null,
      guildId: "guild-1",
    });
    const context = {
      services: {
        contests: {
          refresh: jest.fn().mockResolvedValue(undefined),
          getOngoing: jest.fn().mockReturnValue([]),
          getUpcoming: jest.fn().mockReturnValue([
            {
              id: 103,
              name: "Codeforces Round #900 (Div. 2)",
              phase: "BEFORE",
              startTimeSeconds: 1_700_000_600,
              durationSeconds: 7200,
            },
          ]),
          getLastRefreshAt: jest.fn().mockReturnValue(1_700_000_000),
        },
        contestFilters: {
          getSettings: jest.fn().mockResolvedValue({
            guildId: "guild-1",
            includeKeywords: "div. 2",
            excludeKeywords: null,
            scope: "gym",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }),
        },
      },
    } as unknown as CommandContext;

    await contestsCommand.execute(interaction, context);

    expect(context.services.contests.refresh).toHaveBeenCalledWith(false, "gym");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.footer?.text).toContain("Defaults applied.");
  });
});
