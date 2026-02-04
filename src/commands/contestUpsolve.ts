import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { buildContestEmbed } from "../utils/contestLookup.js";
import { splitContestSolves } from "../utils/contestProblems.js";
import { addContestScopeOption } from "../utils/contestScope.js";
import {
  applyContestSolvesStaleFooter,
  buildContestSolvesSummaryFields,
  resolveContestSolvesCommandOptionsOrReply,
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

type UpsolveTargetResult =
  | {
      status: "ok";
      handle: string;
      targetLabel: string;
      titleTarget: string;
    }
  | { status: "replied" };

async function resolveUpsolveTargetOrReply(options: {
  interaction: { editReply: (message: string) => Promise<unknown> };
  store: Parameters<typeof resolveHandleTargetWithOptionalGuild>[0];
  guildId: string | null;
  targetId: string;
  handleInput: string;
  mention: string;
  displayName: string;
}): Promise<UpsolveTargetResult> {
  const handleResult = await resolveHandleTargetWithOptionalGuild(options.store, {
    guildId: options.guildId,
    targetId: options.targetId,
    handleInput: options.handleInput,
    includeLinkedUserId: true,
  });
  if ("error" in handleResult) {
    await options.interaction.editReply(handleResult.error);
    return { status: "replied" };
  }

  const labels = buildUpsolveTargetLabels({
    handle: handleResult.handle,
    handleInput: options.handleInput,
    linkedUserId: handleResult.linkedUserId,
    mention: options.mention,
    displayName: options.displayName,
  });

  return { status: "ok", handle: handleResult.handle, ...labels };
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

    const optionResult = await resolveContestSolvesCommandOptionsOrReply(interaction, {
      defaultLimit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
    });
    if (optionResult.status === "replied") {
      return;
    }
    const { queryRaw, scope, limit, forceRefresh } = optionResult;

    await interaction.deferReply();

    try {
      const targetResult = await resolveUpsolveTargetOrReply({
        interaction,
        store: context.services.store,
        guildId: interaction.guild?.id ?? null,
        targetId,
        handleInput,
        mention,
        displayName,
      });
      if (targetResult.status === "replied") {
        return;
      }

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
        new Map([[targetResult.handle, targetResult.handle]])
      );
      const solvedCount = solved.length;
      const unsolvedCount = unsolved.length;

      const embed = buildContestEmbed({
        contest,
        title: `Contest upsolve: ${targetResult.titleTarget}`,
        scope,
        includeScope: true,
      });
      embed.addFields({ name: "Target", value: targetResult.targetLabel, inline: false });
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
