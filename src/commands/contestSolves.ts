import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import {
  buildContestEmbed,
  resolveContestOrReply,
} from "../utils/contestLookup.js";
import {
  compareProblemIndex,
  formatContestProblemLine,
  getContestProblems,
  splitContestSolves,
} from "../utils/contestProblems.js";
import { parseContestScope, refreshContestData } from "../utils/contestScope.js";
import { getUserOptions, resolveContestTargets } from "../utils/contestTargets.js";
import { parseHandleList } from "../utils/handles.js";
import { resolveBoundedIntegerOption } from "../utils/interaction.js";

import type { Command } from "./types.js";

const MAX_MATCHES = 5;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

export const contestSolvesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestsolves")
    .setDescription("Shows which contest problems linked users have solved")
    .addStringOption((option) =>
      option.setName("query").setDescription("Contest id, URL, or name").setRequired(true)
    )
    .addUserOption((option) => option.setName("user1").setDescription("User to include"))
    .addUserOption((option) => option.setName("user2").setDescription("User to include"))
    .addUserOption((option) => option.setName("user3").setDescription("User to include"))
    .addUserOption((option) => option.setName("user4").setDescription("User to include"))
    .addStringOption((option) =>
      option.setName("handles").setDescription("Comma or space separated handles to include")
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
    const queryRaw = interaction.options.getString("query", true).trim();
    const handlesRaw = interaction.options.getString("handles")?.trim() ?? "";
    const scope = parseContestScope(interaction.options.getString("scope"));
    const resolvedLimit = resolveBoundedIntegerOption(interaction, {
      name: "limit",
      defaultValue: DEFAULT_LIMIT,
      min: 1,
      max: MAX_LIMIT,
      errorMessage: "Invalid limit.",
    });
    if ("error" in resolvedLimit) {
      await interaction.reply({ content: resolvedLimit.error });
      return;
    }
    const { value: limit } = resolvedLimit;
    const handleInputs = parseHandleList(handlesRaw);
    const userOptions = getUserOptions([
      interaction.options.getUser("user1"),
      interaction.options.getUser("user2"),
      interaction.options.getUser("user3"),
      interaction.options.getUser("user4"),
    ]);

    if (!interaction.guild && userOptions.length > 0) {
      await interaction.reply({
        content: "Specify handles directly when using this command outside a server.",
      });
      return;
    }

    if (!interaction.guild && handleInputs.length === 0) {
      await interaction.reply({
        content: "Provide at least one handle or run this command in a server.",
      });
      return;
    }

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
        {
          maxMatches: MAX_MATCHES,
          footerText: "Use /contestsolves with the contest ID to see solve counts.",
          refreshWasStale: refreshResult.stale,
        }
      );
      if (lookup.status === "replied") {
        return;
      }

      const contest = lookup.contest;
      const problems = await context.services.problems.ensureProblemsLoaded();
      const contestProblems = getContestProblems(problems, contest.id);
      if (contestProblems.length === 0) {
        await interaction.editReply("No contest problems found in the cache yet.");
        return;
      }

      const targetResult = await resolveContestTargets({
        guild: interaction.guild,
        guildId: interaction.guildId,
        user: interaction.user,
        commandName: interaction.commandName,
        userOptions,
        handleInputs,
        correlationId: context.correlationId,
        store: context.services.store,
      });
      if (targetResult.status === "error") {
        await interaction.editReply(targetResult.message);
        return;
      }
      const targets = targetResult.targets;

      const contestSolves = await context.services.store.getContestSolvesResult(contest.id);
      if (!contestSolves) {
        await interaction.editReply("Contest submissions cache not ready yet. Try again soon.");
        return;
      }

      const handleToUserId = new Map(targets.map((target) => [target.handle, target.label]));
      const { summaries, solved, unsolved } = splitContestSolves(
        contestProblems,
        contestSolves.solves,
        handleToUserId
      );
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
          `Handles included: ${targets.length}`,
          `Solved problems: ${solvedCount}/${summaries.length}`,
          `Unsolved problems: ${unsolvedCount}`,
        ].join("\n"),
        inline: false,
      });

      if (unsolved.length > 0) {
        const lines = unsolved
          .slice(0, limit)
          .map((entry) => formatContestProblemLine(entry.problem, null))
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
          .sort(
            (a, b) => b.solvedBy.size - a.solvedBy.size || compareProblemIndex(a.problem, b.problem)
          )
          .slice(0, limit)
          .map((entry) => formatContestProblemLine(entry.problem, entry.solvedBy.size))
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
