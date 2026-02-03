import {
  filterContestsByKeywords,
  getContestReminderPreset,
  listContestReminderPresets,
  parseKeywordFilters,
} from "../../src/utils/contestFilters.js";

describe("contestFilters", () => {
  it("parses keyword filters with normalization", () => {
    const filters = parseKeywordFilters(" Div. 2, div. 2 ,", "Kotlin, ");
    expect(filters.includeKeywords).toEqual(["div. 2"]);
    expect(filters.excludeKeywords).toEqual(["kotlin"]);
  });

  it("filters contests by include/exclude keywords", () => {
    const contests = [
      { name: "Codeforces Round #900 (Div. 2)" },
      { name: "Kotlin Heroes: Practice" },
      { name: "Educational Codeforces Round" },
    ];
    const filtered = filterContestsByKeywords(contests, {
      includeKeywords: ["div. 2", "educational"],
      excludeKeywords: ["kotlin"],
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((contest) => contest.name)).toEqual([
      "Codeforces Round #900 (Div. 2)",
      "Educational Codeforces Round",
    ]);
  });

  it("exposes contest reminder presets", () => {
    const presets = listContestReminderPresets();
    expect(presets).toEqual([
      { name: "Div 2", value: "div2" },
      { name: "Div 3", value: "div3" },
      { name: "Div 4", value: "div4" },
      { name: "Educational", value: "educational" },
    ]);
    const preset = getContestReminderPreset("div2");
    expect(preset.includeKeywords).toContain("div. 2");
    const div3Preset = getContestReminderPreset("div3");
    expect(div3Preset.includeKeywords).toContain("div. 3");
    const div4Preset = getContestReminderPreset("div4");
    expect(div4Preset.includeKeywords).toContain("div. 4");
  });
});
