import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import {
  buildContestEmbed,
  resolveContestOrReply,
} from "../utils/contestLookup.js";
import {
  formatContestProblemLines,
  splitContestSolves,
} from "../utils/contestProblems.js";
import { parseContestScope, refreshContestData } from "../utils/contestScope.js";
import { loadContestSolvesData } from "../utils/contestSolvesData.js";
import { resolveHandleTarget } from "../utils/handles.js";
import {
  resolveBoundedIntegerOption,
  resolveHandleUserOptions,
  resolveTargetLabels,
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
          footerText: "Use /contestupsolve with the contest ID to list unsolved problems.",
          refreshWasStale: refreshResult.stale,
        }
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
      const contestData = await loadContestSolvesData(
        context.services.problems,
        context.services.store,
        contest.id
      );
      if (contestData.status === "no_problems") {
        await interaction.editReply("No contest problems found in the cache yet.");
        return;
      }
      if (contestData.status === "no_solves") {
        await interaction.editReply("Contest submissions cache not ready yet. Try again soon.");
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

      if (unsolved.length > 0) {
        embed.addFields({
          name: "Unsolved problems",
          value: formatContestProblemLines(unsolved, limit),
          inline: false,
        });
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
