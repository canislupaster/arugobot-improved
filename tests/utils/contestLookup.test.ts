import type { ChatInputCommandInteraction } from "discord.js";

import type { Contest, ContestScopeFilter } from "../../src/services/contests.js";
import {
  buildContestEmbed,
  buildContestMatchEmbed,
  formatContestPhase,
  formatContestTag,
  isLatestQuery,
  isOngoingQuery,
  isUpcomingQuery,
  parseContestId,
  resolveContestLookup,
  resolveContestOrReply,
} from "../../src/utils/contestLookup.js";

describe("contestLookup helpers", () => {
  it("parses contest ids from ids and URLs", () => {
    expect(parseContestId("1234")).toBe(1234);
    expect(parseContestId("https://codeforces.com/contest/5678")).toBe(5678);
    expect(parseContestId("https://codeforces.com/contests/9012")).toBe(9012);
    expect(parseContestId("https://codeforces.com/gym/3456")).toBe(3456);
    expect(parseContestId("not a contest")).toBeNull();
  });

  it("detects latest contest queries", () => {
    expect(isLatestQuery("latest")).toBe(true);
    expect(isLatestQuery("LAST")).toBe(true);
    expect(isLatestQuery("recent")).toBe(true);
    expect(isLatestQuery("older")).toBe(false);
  });

  it("detects upcoming and ongoing contest queries", () => {
    expect(isUpcomingQuery("next")).toBe(true);
    expect(isUpcomingQuery("Upcoming")).toBe(true);
    expect(isUpcomingQuery("soon")).toBe(true);
    expect(isUpcomingQuery("later")).toBe(false);
    expect(isOngoingQuery("ongoing")).toBe(true);
    expect(isOngoingQuery("LIVE")).toBe(true);
    expect(isOngoingQuery("current")).toBe(true);
    expect(isOngoingQuery("done")).toBe(false);
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

  it("resolves contest lookup queries", () => {
    const contests: Contest[] = [
      {
        id: 101,
        name: "Round 101",
        phase: "FINISHED",
        startTimeSeconds: 1_700_000_000,
        durationSeconds: 7200,
        isGym: false,
      },
      {
        id: 202,
        name: "Round 202",
        phase: "FINISHED",
        startTimeSeconds: 1_700_100_000,
        durationSeconds: 7200,
        isGym: false,
      },
    ];
    const contestService = {
      getLatestFinished: (_scope: ContestScopeFilter) => contests[1] ?? null,
      getUpcoming: (_limit: number, _scope: ContestScopeFilter) => [],
      getOngoing: (_scope: ContestScopeFilter) => [],
      getContestById: (contestId: number, _scope: ContestScopeFilter) =>
        contests.find((contest) => contest.id === contestId) ?? null,
      searchContests: (query: string, _limit: number, _scope: ContestScopeFilter) =>
        contests.filter((contest) => contest.name.toLowerCase().includes(query.toLowerCase())),
    };

    const latestLookup = resolveContestLookup("latest", "official", contestService, 5);
    expect(latestLookup.status).toBe("ok");
    if (latestLookup.status === "ok") {
      expect(latestLookup.contest.id).toBe(202);
    }

    const idLookup = resolveContestLookup("101", "official", contestService, 5);
    expect(idLookup.status).toBe("ok");
    if (idLookup.status === "ok") {
      expect(idLookup.contest.name).toBe("Round 101");
    }

    const missingLookup = resolveContestLookup("999", "official", contestService, 5);
    expect(missingLookup.status).toBe("missing_id");

    const ambiguousLookup = resolveContestLookup("Round", "official", contestService, 5);
    expect(ambiguousLookup.status).toBe("ambiguous");
    if (ambiguousLookup.status === "ambiguous") {
      expect(ambiguousLookup.matches).toHaveLength(2);
    }
  });

  it("resolves upcoming and ongoing contest queries when enabled", () => {
    const upcomingContest: Contest = {
      id: 303,
      name: "Upcoming Contest",
      phase: "BEFORE",
      startTimeSeconds: 1_800_000_000,
      durationSeconds: 7200,
      isGym: false,
    };
    const ongoingContest: Contest = {
      id: 404,
      name: "Ongoing Contest",
      phase: "CODING",
      startTimeSeconds: 1_700_500_000,
      durationSeconds: 7200,
      isGym: false,
    };
    const contestService = {
      getLatestFinished: (_scope: ContestScopeFilter) => null,
      getUpcoming: (_limit: number, _scope: ContestScopeFilter) => [upcomingContest],
      getOngoing: (_scope: ContestScopeFilter) => [ongoingContest],
      getContestById: (_contestId: number, _scope: ContestScopeFilter) => null,
      searchContests: (_query: string, _limit: number, _scope: ContestScopeFilter) => [],
    };

    const upcomingLookup = resolveContestLookup("next", "official", contestService, 5, {
      allowUpcoming: true,
    });
    expect(upcomingLookup.status).toBe("ok");
    if (upcomingLookup.status === "ok") {
      expect(upcomingLookup.contest.id).toBe(303);
    }

    const ongoingLookup = resolveContestLookup("ongoing", "official", contestService, 5, {
      allowOngoing: true,
    });
    expect(ongoingLookup.status).toBe("ok");
    if (ongoingLookup.status === "ok") {
      expect(ongoingLookup.contest.id).toBe(404);
    }
  });

  it("uses custom missing-id messages when contest lookup fails", async () => {
    const contestService = {
      getLatestFinished: (_scope: ContestScopeFilter) => null,
      getUpcoming: (_limit: number, _scope: ContestScopeFilter) => [],
      getOngoing: (_scope: ContestScopeFilter) => [],
      getContestById: (_contestId: number, _scope: ContestScopeFilter) => null,
      searchContests: (_query: string, _limit: number, _scope: ContestScopeFilter) => [],
    };
    const interaction = {
      editReply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    const result = await resolveContestOrReply(
      interaction,
      "123",
      "official",
      contestService,
      {
        footerText: "Use /contest.",
        refreshWasStale: false,
        missingIdMessage: "No contest with that ID.",
      }
    );

    expect(result).toEqual({ status: "replied" });
    expect(interaction.editReply).toHaveBeenCalledWith("No contest with that ID.");
  });
});
