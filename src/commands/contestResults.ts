import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { resolveContestContextOrReply } from "../utils/contestCommand.js";
import { buildRankedLines, formatTargetLabel } from "../utils/contestEntries.js";
import { buildContestEmbed, formatContestTag } from "../utils/contestLookup.js";
import { addContestScopeOption, parseContestScope } from "../utils/contestScope.js";
import {
  buildMissingTargetsField,
  partitionTargetsByHandle,
  resolveContestTargetsFromInteractionOrReply,
} from "../utils/contestTargets.js";

import type { Command } from "./types.js";

const MAX_MATCHES = 5;
const MAX_HANDLES = 50;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
function formatParticipantType(type: string): string {
  switch (type) {
    case "OUT_OF_COMPETITION":
      return "OOC";
    case "VIRTUAL":
      return "Virtual";
    case "PRACTICE":
      return "Practice";
    default:
      return type;
  }
}

function formatPoints(points: number): string {
  if (!Number.isFinite(points)) {
    return "0";
  }
  if (Number.isInteger(points)) {
    return String(points);
  }
  return points.toFixed(2);
}

export const contestResultsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestresults")
    .setDescription("Shows standings for linked users in a contest")
    .addStringOption((option) =>
      option.setName("query").setDescription("Contest id, URL, name, or latest").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of results to show (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    )
    .addUserOption((option) => option.setName("user1").setDescription("User to include"))
    .addUserOption((option) => option.setName("user2").setDescription("User to include"))
    .addUserOption((option) => option.setName("user3").setDescription("User to include"))
    .addUserOption((option) => option.setName("user4").setDescription("User to include"))
    .addStringOption((option) =>
      option.setName("handles").setDescription("Comma or space separated handles to include")
    )
    .addBooleanOption((option) =>
      option
        .setName("include_practice")
        .setDescription("Include practice submissions in the standings")
    )
    .addStringOption((option) => addContestScopeOption(option)),
  async execute(interaction, context) {
    const queryRaw = interaction.options.getString("query", true).trim();
    const handlesRaw = interaction.options.getString("handles") ?? "";
    const includePractice = interaction.options.getBoolean("include_practice") ?? false;
    const scope = parseContestScope(interaction.options.getString("scope"));

    try {
      const contestResult = await resolveContestContextOrReply({
        interaction,
        services: context.services,
        queryRaw,
        handlesRaw,
        scope,
        maxMatches: MAX_MATCHES,
        lookupOptions: {
          footerText: "Use /contestresults with the contest ID for standings.",
          missingLatestMessage: "No finished contests found yet.",
          missingUpcomingMessage: "No upcoming contests found yet.",
          missingOngoingMessage: "No ongoing contests found right now.",
          missingIdMessage: "No contest found with that ID.",
          missingNameMessage: "No contests found matching that name.",
        },
      });
      if (contestResult.status === "replied") {
        return;
      }

      const targetResult = await resolveContestTargetsFromInteractionOrReply({
        interaction,
        ...contestResult.targetInputs,
        correlationId: context.correlationId,
        store: context.services.store,
        maxLinkedHandles: MAX_HANDLES,
      });
      if (targetResult.status === "replied") {
        return;
      }

      const { contest, stale } = contestResult;
      const targetList = targetResult.targets;

      const standings = await context.services.contestStandings.getStandings(
        contest.id,
        targetList.map((target) => target.handle),
        contest.phase,
        includePractice
      );

      const standingsEntries = includePractice
        ? standings.entries
        : standings.entries.filter((entry) => entry.participantType !== "PRACTICE");
      const entryMap = new Map(
        standingsEntries.map((entry) => [entry.handle.toLowerCase(), entry])
      );

      const { found, missing } = partitionTargetsByHandle(targetList, entryMap);

      const embed = buildContestEmbed({
        contest,
        title: `Contest results: ${contest.name}`,
      });
      const scopeLabel = formatContestTag(contest, scope);
      if (scopeLabel) {
        embed.addFields({ name: "Section", value: scopeLabel, inline: true });
      }
      const footerNotes: string[] = [];

      if (found.length === 0) {
        embed.addFields({
          name: "Standings",
          value:
            contest.phase === "BEFORE"
              ? "Contest has not started yet."
              : "No standings found for the selected handles.",
          inline: false,
        });
      } else {
        const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
        const { lines, truncated, total } = buildRankedLines(found, limit, (entry) => {
          const display = formatTargetLabel(entry.label, entry.handle);
          const rank = entry.rank > 0 ? `#${entry.rank}` : "Unranked";
          const points = formatPoints(entry.points);
          const penalty = Number.isFinite(entry.penalty) ? String(entry.penalty) : "0";
          const typeLabel =
            entry.participantType && entry.participantType !== "CONTESTANT"
              ? ` • ${formatParticipantType(entry.participantType)}`
              : "";
          return `${rank} ${display} • ${points} pts • ${penalty} pen${typeLabel}`;
        });

        embed.addFields({ name: "Standings", value: lines.join("\n"), inline: false });

        if (truncated) {
          footerNotes.push(`Showing top ${limit} of ${total} entries.`);
        }
      }

      const missingField = buildMissingTargetsField(missing);
      if (missingField) {
        embed.addFields(missingField);
      }

      if (stale || standings.isStale) {
        footerNotes.push("Showing cached data due to a temporary Codeforces error.");
      }

      if (footerNotes.length > 0) {
        embed.setFooter({ text: footerNotes.join(" ") });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contestresults: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
