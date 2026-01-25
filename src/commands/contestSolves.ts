import { SlashCommandBuilder } from "discord.js";

import type { Contest, ContestScopeFilter } from "../services/contests.js";
import type { Problem } from "../services/problems.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  buildContestEmbed,
  buildContestMatchEmbed,
  isLatestQuery,
  parseContestId,
} from "../utils/contestLookup.js";
import { parseContestScope, refreshContestData } from "../utils/contestScope.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";

import type { Command } from "./types.js";

const MAX_MATCHES = 5;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

type ContestLookup =
  | { status: "ok"; contest: Contest }
  | { status: "ambiguous"; matches: Contest[] }
  | { status: "missing_latest" | "missing_id" | "missing_name" };

type ProblemSolveSummary = {
  problem: Problem;
  solvedCount: number;
};

function lookupContest(
  queryRaw: string,
  scope: ContestScopeFilter,
  contests: {
    getLatestFinished: (scopeFilter: ContestScopeFilter) => Contest | null;
    getContestById: (contestId: number, scopeFilter: ContestScopeFilter) => Contest | null;
    searchContests: (query: string, limit: number, scopeFilter: ContestScopeFilter) => Contest[];
  }
): ContestLookup {
  const wantsLatest = isLatestQuery(queryRaw);
  const contestId = parseContestId(queryRaw);
  if (wantsLatest) {
    const contest = contests.getLatestFinished(scope);
    if (!contest) {
      return { status: "missing_latest" };
    }
    return { status: "ok", contest };
  }
  if (contestId) {
    const contest = contests.getContestById(contestId, scope);
    if (!contest) {
      return { status: "missing_id" };
    }
    return { status: "ok", contest };
  }
  const matches = contests.searchContests(queryRaw, MAX_MATCHES, scope);
  if (matches.length === 0) {
    return { status: "missing_name" };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return { status: "ok", contest: matches[0] };
}

function compareProblemIndex(a: Problem, b: Problem): number {
  return a.index.localeCompare(b.index, "en", { numeric: true });
}

function buildProblemLink(problem: Problem): string {
  return `https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`;
}

function formatProblemLine(problem: Problem, solvedCount: number | null): string {
  const label = `[${problem.index}. ${problem.name}](${buildProblemLink(problem)})`;
  if (solvedCount === null) {
    return label;
  }
  return `${label} • ${solvedCount} solved`;
}

export const contestSolvesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestsolves")
    .setDescription("Shows which contest problems linked users have solved")
    .addStringOption((option) =>
      option.setName("query").setDescription("Contest id, URL, or name").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Which contests to search")
        .addChoices(
          { name: "Official", value: "official" },
          { name: "Gym", value: "gym" },
          { name: "All", value: "all" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Max problems per list (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({ content: "This command can only be used in a server." });
      return;
    }

    const queryRaw = interaction.options.getString("query", true).trim();
    const scope = parseContestScope(interaction.options.getString("scope"));
    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      await interaction.reply({ content: "Invalid limit." });
      return;
    }

    await interaction.deferReply();

    const refreshResult = await refreshContestData(context.services.contests, scope);
    if ("error" in refreshResult) {
      await interaction.editReply(refreshResult.error);
      return;
    }

    try {
      const lookup = lookupContest(queryRaw, scope, context.services.contests);
      if (lookup.status !== "ok") {
        switch (lookup.status) {
          case "missing_latest":
            await interaction.editReply("No finished contests found yet.");
            return;
          case "missing_id":
            await interaction.editReply("No contest found with that ID.");
            return;
          case "missing_name":
            await interaction.editReply("No contests found matching that name.");
            return;
          case "ambiguous": {
            const embed = buildContestMatchEmbed({
              query: queryRaw,
              matches: lookup.matches,
              scope,
              footerText: "Use /contestsolves with the contest ID to see solve counts.",
            });
            if (refreshResult.stale) {
              embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
            }
            await interaction.editReply({ embeds: [embed] });
            return;
          }
        }
      }

      const contest = lookup.contest;
      const problems = await context.services.problems.ensureProblemsLoaded();
      const contestProblems = problems
        .filter((problem) => problem.contestId === contest.id)
        .sort(compareProblemIndex);
      if (contestProblems.length === 0) {
        await interaction.editReply("No contest problems found in the cache yet.");
        return;
      }

      const linkedUsers = await context.services.store.getLinkedUsers(interaction.guild.id);
      const filteredUsers = await filterEntriesByGuildMembers(interaction.guild, linkedUsers, {
        correlationId: context.correlationId,
        command: interaction.commandName,
        guildId: interaction.guild.id,
        userId: interaction.user.id,
      });
      if (filteredUsers.length === 0) {
        await interaction.editReply("No linked handles found in this server yet.");
        return;
      }

      const contestSolves = await context.services.store.getContestSolvesResult(contest.id);
      if (!contestSolves) {
        await interaction.editReply("Contest submissions cache not ready yet. Try again soon.");
        return;
      }

      const handleToUserId = new Map(
        filteredUsers.map((user) => [user.handle.toLowerCase(), user.userId])
      );
      const solvedByProblem = new Map<string, Set<string>>();
      for (const solve of contestSolves.solves) {
        const userId = handleToUserId.get(solve.handle.toLowerCase());
        if (!userId) {
          continue;
        }
        const problemId = `${solve.contestId}${solve.index}`;
        const entry = solvedByProblem.get(problemId) ?? new Set<string>();
        entry.add(userId);
        solvedByProblem.set(problemId, entry);
      }

      const summaries: ProblemSolveSummary[] = contestProblems.map((problem) => {
        const key = `${problem.contestId}${problem.index}`;
        const solvedCount = solvedByProblem.get(key)?.size ?? 0;
        return { problem, solvedCount };
      });
      const solved = summaries.filter((entry) => entry.solvedCount > 0);
      const unsolved = summaries.filter((entry) => entry.solvedCount === 0);
      const solvedCount = solved.length;
      const unsolvedCount = unsolved.length;

      const embed = buildContestEmbed({
        contest,
        title: `Contest solves: ${contest.name}`,
        scope,
        includeScope: true,
      });
      embed.addFields({
        name: "Summary",
        value: [
          `Linked handles: ${filteredUsers.length}`,
          `Solved problems: ${solvedCount}/${summaries.length}`,
          `Unsolved problems: ${unsolvedCount}`,
        ].join("\n"),
        inline: false,
      });

      if (unsolved.length > 0) {
        const lines = unsolved
          .slice(0, limit)
          .map((entry) => formatProblemLine(entry.problem, null))
          .join("\n");
        embed.addFields({ name: "Unsolved problems", value: lines, inline: false });
      } else {
        embed.addFields({
          name: "Unsolved problems",
          value: "All contest problems were solved by linked users.",
          inline: false,
        });
      }

      if (solved.length > 0) {
        const lines = solved
          .sort((a, b) => b.solvedCount - a.solvedCount || compareProblemIndex(a.problem, b.problem))
          .slice(0, limit)
          .map((entry) => formatProblemLine(entry.problem, entry.solvedCount))
          .join("\n");
        embed.addFields({ name: "Solved problems", value: lines, inline: false });
      }

      const showStale = refreshResult.stale || contestSolves.isStale;
      if (showStale) {
        embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in contest solves: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
