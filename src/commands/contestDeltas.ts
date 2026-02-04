import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type {
  GuildRatingChangeSummary,
  RatingChangeParticipantSummary,
} from "../services/contestActivity.js";
import type { ContestScopeFilter } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  CONTEST_ACTIVITY_DEFAULTS,
  addContestActivityCommandOptions,
  buildContestActivityOptionConfig,
  resolveContestActivityRosterContextOrReply,
} from "../utils/contestActivityOptions.js";
import { formatContestScopeLabel } from "../utils/contestScope.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { formatRatingDelta } from "../utils/ratingChanges.js";
import { buildRosterExcludedField } from "../utils/roster.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

function formatParticipantLine(entry: RatingChangeParticipantSummary): string {
  const lastContest =
    entry.lastContestAt && entry.lastContestAt > 0
      ? ` • last ${formatDiscordRelativeTime(entry.lastContestAt)}`
      : "";
  return `<@${entry.userId}> (${entry.handle}) • ${formatRatingDelta(entry.delta, {
    round: true,
  })} • ${
    entry.contestCount
  } contests${lastContest}`;
}

function formatParticipantSection(
  entries: RatingChangeParticipantSummary[],
  emptyLabel: string
): string {
  if (entries.length === 0) {
    return emptyLabel;
  }
  return entries.map((entry, index) => `${index + 1}. ${formatParticipantLine(entry)}`).join("\n");
}

function buildSummaryEmbed(
  summary: GuildRatingChangeSummary,
  days: number,
  scope: ContestScopeFilter
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Contest rating deltas")
    .setColor(EMBED_COLORS.info)
    .setDescription(`Last ${days} days • Scope: ${formatContestScopeLabel(scope)}`)
    .addFields(
      { name: "Contests", value: String(summary.contestCount), inline: true },
      { name: "Participants", value: String(summary.participantCount), inline: true },
      {
        name: "Total delta",
        value: formatRatingDelta(summary.totalDelta, { round: true }),
        inline: true,
      }
    );

  if (summary.lastContestAt) {
    embed.addFields({
      name: "Last contest",
      value: formatDiscordRelativeTime(summary.lastContestAt),
      inline: true,
    });
  }

  embed.addFields(
    {
      name: "Top gainers",
      value: formatParticipantSection(summary.topGainers, "No gainers yet."),
      inline: false,
    },
    {
      name: "Top losers",
      value: formatParticipantSection(summary.topLosers, "No losers yet."),
      inline: false,
    }
  );

  return embed;
}

export const contestDeltasCommand: Command = {
  data: addContestActivityCommandOptions(
    new SlashCommandBuilder()
      .setName("contestdeltas")
      .setDescription("Shows recent contest rating changes for this server"),
    {
      limitDescription: `Top gainers/losers to show (1-${CONTEST_ACTIVITY_DEFAULTS.maxLimit})`,
    }
  ),
  async execute(interaction, context) {
    const optionResult = await resolveContestActivityRosterContextOrReply(
      interaction,
      buildContestActivityOptionConfig({
        daysErrorMessage: "Invalid lookback window.",
        limitErrorMessage: "Invalid limit.",
      }),
      {
        guildMessage: "This command can only be used in a server.",
        store: context.services.store,
        correlationId: context.correlationId,
      }
    );
    if (optionResult.status === "replied") {
      return;
    }
    const { days, limit, scope, roster, excludedCount } = optionResult;

    try {
      const summary = await context.services.contestActivity.getRatingChangeSummaryForRoster(
        roster,
        { lookbackDays: days, limit, scope }
      );

      if (summary.contestCount === 0) {
        await interaction.editReply(
          `No rating changes for linked handles in the last ${days} days.`
        );
        return;
      }

      const embed = buildSummaryEmbed(summary, days, scope);
      const excludedField = buildRosterExcludedField(excludedCount);
      if (excludedField) {
        embed.addFields(excludedField);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contest deltas: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
