import { SlashCommandBuilder } from "discord.js";

import type { StoreService } from "../services/store.js";
import { logCommandError } from "../utils/commandLogging.js";
import { buildContestEmbed } from "../utils/contestLookup.js";
import {
  formatUnsolvedProblemsValue,
  splitContestSolves,
} from "../utils/contestProblems.js";
import { parseContestScope } from "../utils/contestScope.js";
import {
  getContestSolvesDataMessage,
  loadContestSolvesData,
  resolveContestSolvesContext,
  shouldShowContestSolvesStale,
} from "../utils/contestSolvesData.js";
import {
  resolveBoundedIntegerOption,
  resolveHandleUserOptions,
  resolveTargetLabels,
} from "../utils/interaction.js";

import type { Command } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

type HandleResolutionResult = { ok: true; handle: string } | { ok: false; error: string };

async function resolveUpsolveHandle(
  store: Pick<StoreService, "resolveHandle" | "getHandle">,
  options: { guildId?: string; targetId: string; handleInput: string }
): Promise<HandleResolutionResult> {
  if (options.handleInput) {
    const handleInfo = await store.resolveHandle(options.handleInput);
    if (!handleInfo.exists) {
      return { ok: false, error: "Invalid handle." };
    }
    return { ok: true, handle: handleInfo.canonicalHandle ?? options.handleInput };
  }

  if (!options.guildId) {
    return { ok: false, error: "Run this command in a server or provide a handle." };
  }

  const linkedHandle = await store.getHandle(options.guildId, options.targetId);
  if (!linkedHandle) {
    return { ok: false, error: "Handle not linked." };
  }
  return { ok: true, handle: linkedHandle };
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
    const handleResolution = resolveHandleUserOptions(interaction);
    if (handleResolution.error) {
      await interaction.reply({ content: handleResolution.error });
      return;
    }

    const { handleInput, userOption, member } = handleResolution;
    if (!interaction.guild && userOption) {
      await interaction.reply({
        content: "Specify handles directly when using this command outside a server.",
      });
      return;
    }
    if (!interaction.guild && !handleInput) {
      await interaction.reply({
        content: "Run this command in a server or provide a handle.",
      });
      return;
    }

    const user = userOption ?? interaction.user;
    const { mention, displayName } = resolveTargetLabels(user, member);
    const targetId = user.id;

    const queryRaw = interaction.options.getString("query", true).trim();
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

      const handleResult = await resolveUpsolveHandle(context.services.store, {
        guildId: interaction.guild?.id,
        targetId,
        handleInput,
      });
      if (!handleResult.ok) {
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
          value: [
            `Solved problems: ${solvedCount}/${summaries.length}`,
            `Unsolved problems: ${unsolvedCount}`,
          ].join("\n"),
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
