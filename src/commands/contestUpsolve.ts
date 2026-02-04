import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { buildContestEmbed } from "../utils/contestLookup.js";
import { splitContestSolves } from "../utils/contestProblems.js";
import { addContestScopeOption } from "../utils/contestScope.js";
import {
  applyContestSolvesStaleFooter,
  loadContestSolvesDataOrReply,
  resolveContestSolvesContext,
  resolveContestSolvesOptionsOrReply,
  buildContestSolvesSummaryFields,
} from "../utils/contestSolvesData.js";
import { resolveHandleTarget } from "../utils/handles.js";
import { resolveHandleTargetLabelsOrReply } from "../utils/interaction.js";

import type { Command } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function buildTargetLabels(input: {
  handle: string;
  handleInput: string;
  linkedUserId: string | null;
  mention: string;
  displayName: string;
}): { targetLabel: string; titleTarget: string } {
  if (input.handleInput) {
    const linkedLabel = input.linkedUserId ? ` (linked to <@${input.linkedUserId}>)` : "";
    return { targetLabel: `${input.handle}${linkedLabel}`, titleTarget: input.handle };
  }
  return {
    targetLabel: `${input.mention} (${input.handle})`,
    titleTarget: input.displayName,
  };
}

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
    const targetResolution = await resolveHandleTargetLabelsOrReply(interaction, {
      contextMessages: {
        userInDm: "Specify handles directly when using this command outside a server.",
        missingHandleInDm: "Run this command in a server or provide a handle.",
      },
    });
    if (targetResolution.status === "replied") {
      return;
    }

    const { handleInput, targetId } = targetResolution;
    const { mention, displayName } = targetResolution.labels;

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
        includeLinkedUserId: true,
      });
      if ("error" in handleResult) {
        await interaction.editReply(handleResult.error);
        return;
      }
      const { handle, linkedUserId } = handleResult;

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
      const { contestProblems, contestSolves } = contestData;

      const { summaries, solved, unsolved } = splitContestSolves(
        contestProblems,
        contestSolves.solves,
        new Map([[handle, handle]])
      );
      const solvedCount = solved.length;
      const unsolvedCount = unsolved.length;
      const { targetLabel, titleTarget } = buildTargetLabels({
        handle,
        handleInput,
        linkedUserId,
        mention,
        displayName,
      });

      const embed = buildContestEmbed({
        contest,
        title: `Contest upsolve: ${titleTarget}`,
        scope,
        includeScope: true,
      });
      embed.addFields({ name: "Target", value: targetLabel, inline: false });
      embed.addFields(
        ...buildContestSolvesSummaryFields({
          totalProblems: summaries.length,
          solvedCount,
          unsolvedCount,
          unsolved,
          limit,
          emptyMessage: "All contest problems were solved by this handle.",
        })
      );

      applyContestSolvesStaleFooter(embed, contestResult.refreshWasStale, contestSolves);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in contest upsolve: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
