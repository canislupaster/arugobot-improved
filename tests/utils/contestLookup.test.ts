import type { Contest } from "../../src/services/contests.js";
import {
  buildContestEmbed,
  buildContestMatchEmbed,
  formatContestPhase,
  formatContestTag,
  isLatestQuery,
  parseContestId,
} from "../../src/utils/contestLookup.js";

describe("contestLookup helpers", () => {
  it("parses contest ids from ids and URLs", () => {
    expect(parseContestId("1234")).toBe(1234);
    expect(parseContestId("https://codeforces.com/contest/5678")).toBe(5678);
    expect(parseContestId("https://codeforces.com/contests/9012")).toBe(9012);
    expect(parseContestId("not a contest")).toBeNull();
  });

  it("detects latest contest queries", () => {
    expect(isLatestQuery("latest")).toBe(true);
    expect(isLatestQuery("LAST")).toBe(true);
    expect(isLatestQuery("recent")).toBe(true);
    expect(isLatestQuery("older")).toBe(false);
  });

  it("formats contest phases and tags", () => {
    expect(formatContestPhase("CODING")).toBe("Ongoing");
    expect(formatContestPhase("FINISHED")).toBe("Finished");
    expect(formatContestPhase("UNKNOWN" as Contest["phase"])).toBe("UNKNOWN");
    const baseContest: Contest = {
      id: 1,
      name: "Contest",
      phase: "FINISHED",
      startTimeSeconds: 0,
      durationSeconds: 0,
      isGym: true,
    };
    expect(formatContestTag(baseContest, "all")).toBe("Gym");
    expect(formatContestTag({ ...baseContest, isGym: false }, "all")).toBe("Official");
    expect(formatContestTag(baseContest, "official")).toBe("");
  });

  it("builds contest embeds with consistent titles", () => {
    const contest: Contest = {
      id: 2468,
      name: "Codeforces Round #2468",
      phase: "FINISHED",
      startTimeSeconds: 1_700_000_000,
      durationSeconds: 7200,
      isGym: false,
    };
    const matchEmbed = buildContestMatchEmbed({
      query: "2468",
      matches: [contest],
      scope: "all",
      footerText: "Use /contest with the contest ID.",
    }).data;
    expect(matchEmbed.title).toBe("Contest matches");
    expect(matchEmbed.description).toContain("2468");
    expect(matchEmbed.description).toContain("Codeforces Round #2468");
    expect(matchEmbed.footer?.text).toBe("Use /contest with the contest ID.");

    const contestEmbed = buildContestEmbed({
      contest,
      title: `Contest results: ${contest.name}`,
    }).data;
    expect(contestEmbed.title).toBe("Contest results: Codeforces Round #2468");
    expect(contestEmbed.fields?.some((field) => field.name === "Contest ID")).toBe(true);
  });
});
