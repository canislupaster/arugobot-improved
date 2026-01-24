import type { ChatInputCommandInteraction } from "discord.js";

import { parseHandles, suggestCommand } from "../../src/commands/suggest.js";
import type { CommandContext } from "../../src/types/commandContext.js";

describe("parseHandles", () => {
  it("splits by comma and whitespace", () => {
    const result = parseHandles("tourist,  petr\nneal  tourist");
    expect(result).toEqual(["tourist", "petr", "neal"]);
  });

  it("returns empty array when no handles", () => {
    const result = parseHandles("   ,,, ");
    expect(result).toEqual([]);
  });
});

describe("suggestCommand", () => {
  it("rejects mixed rating and range input", async () => {
    const interaction = {
      options: {
        getInteger: jest.fn((name: string) => {
          if (name === "rating") return 1200;
          if (name === "min_rating") return 1100;
          return null;
        }),
        getString: jest.fn().mockReturnValue("tourist"),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    const context = {} as CommandContext;
    await suggestCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Use rating, min/max, or ranges, not a mix.",
      ephemeral: true,
    });
  });

  it("adds a footer when solved data is stale", async () => {
    const interaction = {
      options: {
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn((name: string) => {
          if (name === "handles") {
            return "tourist";
          }
          return null;
        }),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    const context = {
      services: {
        problems: {
          ensureProblemsLoaded: jest
            .fn()
            .mockResolvedValue([{ contestId: 1000, index: "A", name: "Test", rating: 800, tags: [] }]),
        },
        store: {
          resolveHandle: jest
            .fn()
            .mockResolvedValue({ exists: true, canonicalHandle: "tourist", source: "api" }),
          getSolvedProblemsResult: jest
            .fn()
            .mockResolvedValue({ solved: [], source: "cache", isStale: true }),
        },
      },
    } as unknown as CommandContext;

    await suggestCommand.execute(interaction, context);

    const replyArg = (interaction.editReply as jest.Mock).mock.calls[0]?.[0];
    expect(replyArg.embeds[0].data.footer?.text).toContain("stale");
  });
});
