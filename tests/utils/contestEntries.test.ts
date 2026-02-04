import { buildRankedLines, formatTargetLabel } from "../../src/utils/contestEntries.js";

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
});
