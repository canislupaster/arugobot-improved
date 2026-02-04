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
  applyContestSolvesStaleFooter,
  buildContestSolvesSummaryFields,
  resolveContestSolvesCommandOptionsOrReply,
  resolveContestSolvesPayloadOrReply,
} from "../utils/contestSolvesData.js";
import {
  resolveContestTargetInputsOrReply,
  resolveContestTargetsFromInteractionOrReply,
} from "../utils/contestTargets.js";

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
    .addBooleanOption((option) =>
      option
        .setName("force_refresh")
        .setDescription("Force refresh contest submissions cache")
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Max problems per list (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    ),
  async execute(interaction, context) {
    const handlesRaw = interaction.options.getString("handles") ?? "";
    const optionResult = await resolveContestSolvesCommandOptionsOrReply(interaction, {
      defaultLimit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
    });
    if (optionResult.status === "replied") {
      return;
    }
    const { queryRaw, scope, limit, forceRefresh } = optionResult;
    const targetInputs = await resolveContestTargetInputsOrReply(interaction, handlesRaw);
    if (targetInputs.status === "replied") {
      return;
    }
    const { handleInputs, userOptions } = targetInputs;

    await interaction.deferReply();

    try {
      const contestPayload = await resolveContestSolvesPayloadOrReply({
        interaction,
        queryRaw,
        scope,
        contests: context.services.contests,
        maxMatches: MAX_MATCHES,
        footerText: "Use /contestsolves with the contest ID to see solve counts.",
        problems: context.services.problems,
        store: context.services.store,
        ttlMs: forceRefresh ? 0 : undefined,
      });
      if (contestPayload.status === "replied") {
        return;
      }

      const targetResult = await resolveContestTargetsFromInteractionOrReply({
        interaction,
        userOptions,
        handleInputs,
        correlationId: context.correlationId,
        store: context.services.store,
      });
      if (targetResult.status === "replied") {
        return;
      }
      const targets = targetResult.targets;

      const { contest, contestProblems, contestSolves } = contestPayload;

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
          isGym: contest.isGym ?? false,
        })
      );

      if (solved.length > 0) {
        const lines = formatContestProblemLines(
          solved.sort(
            (a, b) => b.solvedBy.size - a.solvedBy.size || compareProblemIndex(a.problem, b.problem)
          ),
          limit,
          (entry) => entry.solvedBy.size,
          { isGym: contest.isGym ?? false }
        );
        embed.addFields({ name: "Solved problems", value: lines, inline: false });
      }

      applyContestSolvesStaleFooter(embed, contestPayload.refreshWasStale, contestSolves);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in contest solves: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
