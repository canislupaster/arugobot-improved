import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { buildContestEmbed } from "../utils/contestLookup.js";
import {
  compareProblemIndex,
  formatContestProblemLines,
  splitContestSolves,
} from "../utils/contestProblems.js";
import { addContestScopeOption } from "../utils/contestScope.js";
import {
  loadContestSolvesDataOrReply,
  resolveContestSolvesContext,
  resolveContestSolvesOptionsOrReply,
  shouldShowContestSolvesStale,
  buildContestSolvesSummaryFields,
} from "../utils/contestSolvesData.js";
import { getUserOptions, resolveContestTargets } from "../utils/contestTargets.js";
import { parseHandleList } from "../utils/handles.js";

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
    .addStringOption((option) => addContestScopeOption(option))
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Max problems per list (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    ),
  async execute(interaction, context) {
    const handlesRaw = interaction.options.getString("handles")?.trim() ?? "";
    const optionResult = await resolveContestSolvesOptionsOrReply(interaction, {
      defaultLimit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
    });
    if (optionResult.status === "replied") {
      return;
    }
    const { queryRaw, scope, limit } = optionResult;
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

    try {
      const contestResult = await resolveContestSolvesContext({
        interaction,
        queryRaw,
        scope,
        contests: context.services.contests,
        maxMatches: MAX_MATCHES,
        footerText: "Use /contestsolves with the contest ID to see solve counts.",
      });
      if (contestResult.status === "replied") {
        return;
      }

      const contest = contestResult.contest;
      const contestData = await loadContestSolvesDataOrReply(
        interaction,
        context.services.problems,
        context.services.store,
        contest.id
      );
      if (contestData.status === "replied") {
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

      const { contestProblems, contestSolves } = contestData;

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
      embed.addFields(
        ...buildContestSolvesSummaryFields({
          totalProblems: summaries.length,
          solvedCount,
          unsolvedCount,
          handleCount: targets.length,
          unsolved,
          limit,
          emptyMessage: "All contest problems were solved by linked users.",
        })
      );

      if (solved.length > 0) {
        const lines = formatContestProblemLines(
          solved.sort(
            (a, b) => b.solvedBy.size - a.solvedBy.size || compareProblemIndex(a.problem, b.problem)
          ),
          limit,
          (entry) => entry.solvedBy.size
        );
        embed.addFields({ name: "Solved problems", value: lines, inline: false });
      }

      if (shouldShowContestSolvesStale(contestResult.refreshWasStale, contestSolves)) {
        embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in contest solves: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
