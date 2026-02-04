import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Contest, ContestScopeFilter } from "../services/contests.js";
import type { RatingChange } from "../services/ratingChanges.js";
import { logCommandError } from "../utils/commandLogging.js";
import { buildContestEmbed, resolveContestOrReply } from "../utils/contestLookup.js";
import { addContestScopeOption, parseContestScope, refreshContestData } from "../utils/contestScope.js";
import {
  getContestUserOptions,
  resolveContestTargetsOrReply,
  type TargetHandle,
  validateContestTargetContextOrReply,
} from "../utils/contestTargets.js";
import { parseHandleList } from "../utils/handles.js";
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
    const handlesRaw = interaction.options.getString("handles")?.trim() ?? "";
    const scope = parseContestScope(interaction.options.getString("scope"));
    const handleInputs = parseHandleList(handlesRaw);
    const userOptions = getContestUserOptions(interaction);

    const targetContextResult = await validateContestTargetContextOrReply(interaction, {
      guild: interaction.guild,
      userOptions,
      handleInputs,
    });
    if (targetContextResult.status === "replied") {
      return;
    }

    await interaction.deferReply();

    const refreshResult = await refreshContestData(context.services.contests, scope);
    if ("error" in refreshResult) {
      await interaction.editReply(refreshResult.error);
      return;
    }
    const stale = refreshResult.stale;

    try {
      const lookup = await resolveContestOrReply(
        interaction,
        queryRaw,
        scope,
        context.services.contests,
        {
          maxMatches: MAX_MATCHES,
          footerText: "Use /contestchanges with the contest ID for rating changes.",
          refreshWasStale: stale,
          missingLatestMessage: "No finished contests found yet.",
          missingUpcomingMessage: "No upcoming contests found yet.",
          missingOngoingMessage: "No ongoing contests found right now.",
          missingIdMessage: "No contest found with that ID.",
          missingNameMessage: "No contests found matching that name.",
        }
      );
      if (lookup.status === "replied") {
        return;
      }

      const contest = lookup.contest;

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

      const targetResult = await resolveContestTargetsOrReply({
        interaction,
        guild: interaction.guild,
        guildId: interaction.guildId,
        user: interaction.user,
        commandName: interaction.commandName,
        userOptions,
        handleInputs,
        correlationId: context.correlationId,
        store: context.services.store,
        maxLinkedHandles: MAX_HANDLES,
      });
      if (targetResult.status === "replied") {
        return;
      }
      const targetList = targetResult.targets;

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

      const found: Array<TargetHandle & RatingChange> = [];
      const missing: TargetHandle[] = [];
      for (const target of targetList) {
        const entry = changeMap.get(target.handle.toLowerCase());
        if (!entry) {
          missing.push(target);
          continue;
        }
        found.push({ ...target, ...entry });
      }

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
        const sorted = found.sort((a, b) => a.rank - b.rank);
        const lines = sorted.slice(0, limit).map((entry) => {
          const display = entry.label.startsWith("<@")
            ? `${entry.label} (${entry.handle})`
            : entry.label;
          const delta = entry.newRating - entry.oldRating;
          const rank = entry.rank > 0 ? `#${entry.rank}` : "Unranked";
          return `${rank} ${display} • ${entry.oldRating} → ${entry.newRating} (${formatRatingDelta(
            delta
          )})`;
        });
        embed.addFields({ name: "Rating changes", value: lines.join("\n"), inline: false });

        if (found.length > limit) {
          footerNotes.push(`Showing top ${limit} of ${found.length} entries.`);
        }
      }

      if (missing.length > 0) {
        const preview = missing
          .slice(0, 10)
          .map((entry) => entry.label)
          .join(", ");
        const suffix = missing.length > 10 ? `\n...and ${missing.length - 10} more.` : "";
        embed.addFields({
          name: "Not found",
          value: `${preview}${suffix}`,
          inline: false,
        });
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
