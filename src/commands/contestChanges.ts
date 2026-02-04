import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Contest, ContestScopeFilter } from "../services/contests.js";
import type { RatingChange } from "../services/ratingChanges.js";
import { logCommandError } from "../utils/commandLogging.js";
import { resolveContestContextOrReply } from "../utils/contestCommand.js";
import { buildRankedLines, formatTargetLabel } from "../utils/contestEntries.js";
import { buildContestEmbed } from "../utils/contestLookup.js";
import { addContestScopeOption, parseContestScope } from "../utils/contestScope.js";
import {
  buildMissingTargetsField,
  partitionTargetsByHandle,
  resolveContestTargetsFromContextOrReply,
} from "../utils/contestTargets.js";
import { formatRatingDelta } from "../utils/ratingChanges.js";

import type { Command } from "./types.js";

const MAX_MATCHES = 5;
const MAX_HANDLES = 50;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
function buildContestChangesEmbed(contest: Contest, scope: ContestScopeFilter): EmbedBuilder {
  return buildContestEmbed({
    contest,
    title: `Contest rating changes: ${contest.name}`,
    scope,
    includeScope: true,
    includeEnds: false,
  });
}

function buildContestStatusEmbed(
  contest: Contest,
  scope: ContestScopeFilter,
  message: string
): EmbedBuilder {
  const embed = buildContestChangesEmbed(contest, scope);
  embed.addFields({ name: "Rating changes", value: message, inline: false });
  return embed;
}

function mapChangesByHandle(changes: RatingChange[]): Map<string, RatingChange> {
  const map = new Map<string, RatingChange>();
  for (const change of changes) {
    if (!change.handle) {
      continue;
    }
    map.set(change.handle.toLowerCase(), change);
  }
  return map;
}

export const contestChangesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestchanges")
    .setDescription("Shows rating changes for linked users in a contest")
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
    .addStringOption((option) => addContestScopeOption(option)),
  async execute(interaction, context) {
    const queryRaw = interaction.options.getString("query", true).trim();
    const handlesRaw = interaction.options.getString("handles") ?? "";
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
          footerText: "Use /contestchanges with the contest ID for rating changes.",
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

      const { contest, stale } = contestResult;

      if (contest.isGym) {
        const embed = buildContestStatusEmbed(
          contest,
          scope,
          "Rating changes are not available for gym contests."
        );
        if (stale) {
          embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
        }
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (contest.phase !== "FINISHED") {
        const embed = buildContestStatusEmbed(
          contest,
          scope,
          "Rating changes are only available once the contest is finished."
        );
        if (stale) {
          embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
        }
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const targetList = await resolveContestTargetsFromContextOrReply({
        interaction,
        targetInputs: contestResult.targetInputs,
        correlationId: context.correlationId,
        store: context.services.store,
        maxLinkedHandles: MAX_HANDLES,
      });
      if (!targetList) {
        return;
      }

      const changes = await context.services.contestRatingChanges.getContestRatingChanges(
        contest.id
      );
      if (!changes) {
        await interaction.editReply("Unable to fetch rating changes right now.");
        return;
      }

      if (changes.changes.length === 0) {
        await interaction.editReply("No rating changes found for this contest.");
        return;
      }

      const changeMap = mapChangesByHandle(changes.changes);

      const { found, missing } = partitionTargetsByHandle(targetList, changeMap);

      const embed = buildContestChangesEmbed(contest, scope);
      const footerNotes: string[] = [];

      if (found.length === 0) {
        embed.addFields({
          name: "Rating changes",
          value: "No rating changes found for the selected handles.",
          inline: false,
        });
      } else {
        const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
        const { lines, truncated, total } = buildRankedLines(found, limit, (entry) => {
          const display = formatTargetLabel(entry.label, entry.handle);
          const delta = entry.newRating - entry.oldRating;
          const rank = entry.rank > 0 ? `#${entry.rank}` : "Unranked";
          return `${rank} ${display} • ${entry.oldRating} → ${entry.newRating} (${formatRatingDelta(
            delta
          )})`;
        });
        embed.addFields({ name: "Rating changes", value: lines.join("\n"), inline: false });

        if (truncated) {
          footerNotes.push(`Showing top ${limit} of ${total} entries.`);
        }
      }

      const missingField = buildMissingTargetsField(missing);
      if (missingField) {
        embed.addFields(missingField);
      }

      if (stale || changes.isStale) {
        footerNotes.push("Showing cached data due to a temporary Codeforces error.");
      }

      if (footerNotes.length > 0) {
        embed.setFooter({ text: footerNotes.join(" ") });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contestchanges: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
