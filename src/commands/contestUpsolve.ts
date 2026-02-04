import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { buildContestEmbed } from "../utils/contestLookup.js";
import { splitContestSolves } from "../utils/contestProblems.js";
import { addContestScopeOption } from "../utils/contestScope.js";
import {
  applyContestSolvesStaleFooter,
  resolveContestSolvesOptionsOrReply,
  buildContestSolvesSummaryFields,
  resolveContestSolvesPayloadOrReply,
} from "../utils/contestSolvesData.js";
import { resolveHandleTargetWithOptionalGuild } from "../utils/handles.js";
import { resolveHandleTargetLabelsOrReply } from "../utils/interaction.js";

import type { Command } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

type UpsolveTargetLabels = {
  titleTarget: string;
  targetLabel: string;
};

function buildUpsolveTargetLabels(options: {
  handle: string;
  handleInput: string;
  linkedUserId: string | null;
  mention: string;
  displayName: string;
}): UpsolveTargetLabels {
  const linkedLabel = options.linkedUserId ? ` (linked to <@${options.linkedUserId}>)` : "";
  const targetLabel = options.handleInput
    ? `${options.handle}${linkedLabel}`
    : `${options.mention} (${options.handle})`;
  return {
    targetLabel,
    titleTarget: options.handleInput ? options.handle : options.displayName,
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
    .addBooleanOption((option) =>
      option
        .setName("force_refresh")
        .setDescription("Force refresh contest submissions cache")
    )
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
    const forceRefresh = interaction.options.getBoolean("force_refresh") ?? false;

    await interaction.deferReply();

    try {
      const handleResult = await resolveHandleTargetWithOptionalGuild(context.services.store, {
        guildId: interaction.guild?.id ?? null,
        targetId,
        handleInput,
        includeLinkedUserId: true,
      });
      if ("error" in handleResult) {
        await interaction.editReply(handleResult.error);
        return;
      }
      const { handle, linkedUserId } = handleResult;

      const contestPayload = await resolveContestSolvesPayloadOrReply({
        interaction,
        queryRaw,
        scope,
        contests: context.services.contests,
        footerText: "Use /contestupsolve with the contest ID to list unsolved problems.",
        problems: context.services.problems,
        store: context.services.store,
        ttlMs: forceRefresh ? 0 : undefined,
      });
      if (contestPayload.status === "replied") {
        return;
      }

      const { contest, contestProblems, contestSolves } = contestPayload;

      const { summaries, solved, unsolved } = splitContestSolves(
        contestProblems,
        contestSolves.solves,
        new Map([[handle, handle]])
      );
      const solvedCount = solved.length;
      const unsolvedCount = unsolved.length;
      const { targetLabel, titleTarget } = buildUpsolveTargetLabels({
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

      applyContestSolvesStaleFooter(embed, contestPayload.refreshWasStale, contestSolves);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contest upsolve: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
