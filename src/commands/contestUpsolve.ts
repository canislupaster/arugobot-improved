import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { buildContestEmbed } from "../utils/contestLookup.js";
import {
  formatUnsolvedProblemsValue,
  splitContestSolves,
} from "../utils/contestProblems.js";
import { addContestScopeOption } from "../utils/contestScope.js";
import {
  getContestSolvesDataMessage,
  loadContestSolvesData,
  resolveContestSolvesContext,
  resolveContestSolvesOptionsOrReply,
  shouldShowContestSolvesStale,
  formatContestSolvesSummary,
} from "../utils/contestSolvesData.js";
import { resolveHandleTarget } from "../utils/handles.js";
import {
  resolveHandleUserOptions,
  resolveTargetLabels,
  validateHandleTargetContext,
} from "../utils/interaction.js";

import type { Command } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

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
    .addStringOption((option) => addContestScopeOption(option))
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Max problems to list (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    ),
  async execute(interaction, context) {
    const handleResolution = resolveHandleUserOptions(interaction);
    if (handleResolution.error) {
      await interaction.reply({ content: handleResolution.error });
      return;
    }

    const { handleInput, userOption, member } = handleResolution;
    const contextError = validateHandleTargetContext(interaction, handleInput, userOption, {
      userInDm: "Specify handles directly when using this command outside a server.",
      missingHandleInDm: "Run this command in a server or provide a handle.",
    });
    if (contextError) {
      await interaction.reply({ content: contextError });
      return;
    }

    const user = userOption ?? interaction.user;
    const { mention, displayName } = resolveTargetLabels(user, member);
    const targetId = user.id;

    const optionResult = await resolveContestSolvesOptionsOrReply(interaction, {
      defaultLimit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
    });
    if (optionResult.status === "replied") {
      return;
    }
    const { queryRaw, scope, limit } = optionResult;

    await interaction.deferReply();

    try {
      const contestResult = await resolveContestSolvesContext({
        interaction,
        queryRaw,
        scope,
        contests: context.services.contests,
        footerText: "Use /contestupsolve with the contest ID to list unsolved problems.",
      });
      if (contestResult.status === "replied") {
        return;
      }

      const handleResult = await resolveHandleTarget(context.services.store, {
        guildId: interaction.guildId ?? "",
        targetId,
        handleInput,
      });
      if ("error" in handleResult) {
        await interaction.editReply(handleResult.error);
        return;
      }
      const handle = handleResult.handle;

      const contest = contestResult.contest;
      const contestData = await loadContestSolvesData(
        context.services.problems,
        context.services.store,
        contest.id
      );
      if (contestData.status !== "ok") {
        await interaction.editReply(
          getContestSolvesDataMessage(contestData) ?? "No contest data available."
        );
        return;
      }
      const { contestProblems, contestSolves } = contestData;

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
          value: formatContestSolvesSummary({
            totalProblems: summaries.length,
            solvedCount,
            unsolvedCount,
          }),
          inline: false,
        }
      );

      embed.addFields({
        name: "Unsolved problems",
        value: formatUnsolvedProblemsValue(
          unsolved,
          limit,
          "All contest problems were solved by this handle."
        ),
        inline: false,
      });

      if (shouldShowContestSolvesStale(contestResult.refreshWasStale, contestSolves)) {
        embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in contest upsolve: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
