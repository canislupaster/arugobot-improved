import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";

import type { Contest, ContestScopeFilter } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  buildContestEmbed,
  buildContestMatchEmbed,
  resolveContestLookup,
} from "../utils/contestLookup.js";
import {
  formatContestProblemLine,
  getContestProblems,
  splitContestSolves,
} from "../utils/contestProblems.js";
import { parseContestScope, refreshContestData } from "../utils/contestScope.js";
import { resolveHandleTarget } from "../utils/handles.js";
import { resolveHandleUserOptions, resolveTargetLabels } from "../utils/interaction.js";

import type { Command } from "./types.js";

const MAX_MATCHES = 5;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

type ContestLookupOutcome =
  | { status: "ok"; contest: Contest }
  | { status: "replied" };

const resolveLimit = (
  interaction: ChatInputCommandInteraction
): { limit: number } | { error: string } => {
  const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { error: "Invalid limit." };
  }
  return { limit };
};

const resolveContestOrReply = async (
  interaction: ChatInputCommandInteraction,
  queryRaw: string,
  scope: ContestScopeFilter,
  contests: {
    getLatestFinished: (scopeFilter: ContestScopeFilter) => Contest | null;
    getContestById: (contestId: number, scopeFilter: ContestScopeFilter) => Contest | null;
    searchContests: (query: string, limit: number, scopeFilter: ContestScopeFilter) => Contest[];
  },
  refreshWasStale: boolean
): Promise<ContestLookupOutcome> => {
  const lookup = resolveContestLookup(queryRaw, scope, contests, MAX_MATCHES);
  if (lookup.status === "ok") {
    return { status: "ok", contest: lookup.contest };
  }
  if (lookup.status === "ambiguous") {
    const embed = buildContestMatchEmbed({
      query: queryRaw,
      matches: lookup.matches,
      scope,
      footerText: "Use /contestupsolve with the contest ID to list unsolved problems.",
    });
    if (refreshWasStale) {
      embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
    }
    await interaction.editReply({ embeds: [embed] });
    return { status: "replied" };
  }

  const errorMessage =
    lookup.status === "missing_latest"
      ? "No finished contests found yet."
      : lookup.status === "missing_id"
        ? "No contest found with that ID."
        : "No contests found matching that name.";
  await interaction.editReply(errorMessage);
  return { status: "replied" };
};

export const contestUpsolveCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestupsolve")
    .setDescription("Shows unsolved contest problems for a user or handle")
    .addStringOption((option) =>
      option.setName("query").setDescription("Contest id, URL, or name").setRequired(true)
    )
    .addUserOption((option) => option.setName("user").setDescription("User to target"))
    .addStringOption((option) =>
      option.setName("handle").setDescription("Codeforces handle to target")
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
        .setDescription(`Max problems to list (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({ content: "This command can only be used in a server." });
      return;
    }

    const handleResolution = resolveHandleUserOptions(interaction);
    if (handleResolution.error) {
      await interaction.reply({ content: handleResolution.error });
      return;
    }

    const { handleInput, userOption, member } = handleResolution;
    const user = userOption ?? interaction.user;
    const { mention, displayName } = resolveTargetLabels(user, member);
    const targetId = user.id;

    const queryRaw = interaction.options.getString("query", true).trim();
    const scope = parseContestScope(interaction.options.getString("scope"));
    const resolvedLimit = resolveLimit(interaction);
    if ("error" in resolvedLimit) {
      await interaction.reply({ content: resolvedLimit.error });
      return;
    }
    const { limit } = resolvedLimit;

    await interaction.deferReply();

    const refreshResult = await refreshContestData(context.services.contests, scope);
    if ("error" in refreshResult) {
      await interaction.editReply(refreshResult.error);
      return;
    }

    try {
      const lookup = await resolveContestOrReply(
        interaction,
        queryRaw,
        scope,
        context.services.contests,
        refreshResult.stale
      );
      if (lookup.status === "replied") {
        return;
      }

      const handleTarget = await resolveHandleTarget(context.services.store, {
        guildId: interaction.guild.id,
        targetId,
        handleInput,
      });
      if ("error" in handleTarget) {
        await interaction.editReply(handleTarget.error);
        return;
      }
      const handle = handleTarget.handle;

      const contest = lookup.contest;
      const problems = await context.services.problems.ensureProblemsLoaded();
      const contestProblems = getContestProblems(problems, contest.id);
      if (contestProblems.length === 0) {
        await interaction.editReply("No contest problems found in the cache yet.");
        return;
      }

      const contestSolves = await context.services.store.getContestSolvesResult(contest.id);
      if (!contestSolves) {
        await interaction.editReply("Contest submissions cache not ready yet. Try again soon.");
        return;
      }

      const { summaries, solved, unsolved } = splitContestSolves(
        contestProblems,
        contestSolves.solves,
        new Map([[handle, handle]])
      );
      const solvedCount = solved.length;
      const unsolvedCount = unsolved.length;
      const targetLabel = handleInput ? handle : `${mention} (${handle})`;
      const titleTarget = handleInput ? handle : displayName;

      const embed = buildContestEmbed({
        contest,
        title: `Contest upsolve: ${titleTarget}`,
        scope,
        includeScope: true,
      });
      embed.addFields(
        { name: "Target", value: targetLabel, inline: false },
        {
          name: "Summary",
          value: [
            `Solved problems: ${solvedCount}/${summaries.length}`,
            `Unsolved problems: ${unsolvedCount}`,
          ].join("\n"),
          inline: false,
        }
      );

      if (unsolved.length > 0) {
        const lines = unsolved
          .slice(0, limit)
          .map((entry) => formatContestProblemLine(entry.problem, null))
          .join("\n");
        embed.addFields({ name: "Unsolved problems", value: lines, inline: false });
      } else {
        embed.addFields({
          name: "Unsolved problems",
          value: "All contest problems were solved by this handle.",
          inline: false,
        });
      }

      const showStale = refreshResult.stale || contestSolves.isStale;
      if (showStale) {
        embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in contest upsolve: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
