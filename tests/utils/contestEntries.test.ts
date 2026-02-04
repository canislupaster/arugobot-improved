import { EmbedBuilder } from "discord.js";

import {
  addRankedLinesField,
  buildRankedLines,
  formatTargetLabel,
} from "../../src/utils/contestEntries.js";

describe("contestEntries", () => {
  it("formats mention labels with handles", () => {
    expect(formatTargetLabel("<@123>", "tourist")).toBe("<@123> (tourist)");
    expect(formatTargetLabel("tourist", "tourist")).toBe("tourist");
  });

  it("builds ranked lines with truncation info", () => {
    const entries = [
      { rank: 3, value: "c" },
      { rank: 1, value: "a" },
      { rank: 2, value: "b" },
    ];
    const { lines, truncated, total } = buildRankedLines(entries, 2, (entry) => entry.value);
    expect(lines).toEqual(["a", "b"]);
    expect(truncated).toBe(true);
    expect(total).toBe(3);
  });

  it("adds ranked line fields and footer notes", () => {
    const embed = new EmbedBuilder();
    const footerNotes: string[] = [];
    addRankedLinesField({
      embed,
      entries: [
        { rank: 2, value: "b" },
        { rank: 1, value: "a" },
      ],
      limit: 1,
      fieldName: "Standings",
      footerNotes,
      formatLine: (entry) => entry.value,
    });

    const json = embed.toJSON();
    expect(json.fields?.[0]?.name).toBe("Standings");
    expect(json.fields?.[0]?.value).toBe("a");
    expect(footerNotes).toEqual(["Showing top 1 of 2 entries."]);
  });
});
