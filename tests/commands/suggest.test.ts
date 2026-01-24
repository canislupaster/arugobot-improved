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
      content: "Use either rating or min/max, not both.",
      ephemeral: true,
    });
  });
});
