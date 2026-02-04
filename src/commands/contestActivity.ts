import { SlashCommandBuilder } from "discord.js";

import type { ContestScopeFilter } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  CONTEST_ACTIVITY_DEFAULTS,
  addContestActivityCommandOptions,
  resolveContestActivityRosterContextForCommand,
} from "../utils/contestActivityOptions.js";
import { buildContestSummaryEmbedBase } from "../utils/contestEmbeds.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { appendRosterExcludedField } from "../utils/roster.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const contestActivityRosterMessages = {
  daysErrorMessage: "Invalid lookback window.",
  limitErrorMessage: "Invalid participant limit.",
  guildMessage: "This command can only be used in a server.",
};

function formatScopeSummary(
  label: string,
  summary: { contestCount: number; participantCount: number; lastContestAt: number | null }
): string {
  const last =
    summary.lastContestAt && summary.lastContestAt > 0
      ? formatDiscordRelativeTime(summary.lastContestAt)
      : "None";
  return `${label}: ${summary.contestCount} contests • ${summary.participantCount} participants • last ${last}`;
}

function formatContestLine(
  contest: {
    contestId: number;
    contestName: string;
    ratingUpdateTimeSeconds: number;
    scope: "official" | "gym";
  },
  participantCount?: number
): string {
  const scopeLabel = contest.scope === "gym" ? "Gym" : "Official";
  const parts = [
    `${contest.contestName} (${contest.contestId})`,
    participantCount !== undefined ? `${participantCount} participants` : null,
    scopeLabel,
    formatDiscordRelativeTime(contest.ratingUpdateTimeSeconds),
  ].filter((part): part is string => Boolean(part));
  return parts.join(" • ");
}

function getParticipantCountForScope(
  participant: { contestCount: number; officialCount: number; gymCount: number },
  scope: ContestScopeFilter
): number {
  if (scope === "official") {
    return participant.officialCount;
  }
  if (scope === "gym") {
    return participant.gymCount;
  }
  return participant.contestCount;
}

function buildParticipantLines(
  participants: Array<{
    userId: string;
    handle: string;
    contestCount: number;
    officialCount: number;
    gymCount: number;
  }>,
  scope: ContestScopeFilter
): string {
  const countForScope = (participant: {
    contestCount: number;
    officialCount: number;
    gymCount: number;
  }) => getParticipantCountForScope(participant, scope);
  const sorted = participants.slice().sort((a, b) => {
    const countA = countForScope(a);
    const countB = countForScope(b);
    if (countB !== countA) {
      return countB - countA;
    }
    return a.handle.localeCompare(b.handle);
  });
  return sorted
    .filter((entry) => countForScope(entry) > 0)
    .map(
      (entry, index) =>
        `${index + 1}. <@${entry.userId}> (${entry.handle}) - ${countForScope(entry)}`
    )
    .join("\n");
}

function filterRecentContests<T extends { scope: "official" | "gym" }>(
  contests: T[],
  scope: ContestScopeFilter
): T[] {
  if (scope === "all") {
    return contests;
  }
  return contests.filter((contest) => contest.scope === scope);
}

export const contestActivityCommand: Command = {
  data: addContestActivityCommandOptions(
    new SlashCommandBuilder()
      .setName("contestactivity")
      .setDescription("Shows recent contest participation for this server"),
    {
      limitDescription: `Top participants to show (1-${CONTEST_ACTIVITY_DEFAULTS.maxLimit})`,
    }
  ),
  async execute(interaction, context) {
    const optionResult = await resolveContestActivityRosterContextForCommand(
      interaction,
      context,
      contestActivityRosterMessages
    );
    if (!optionResult) {
      return;
    }
    const { days, limit, scope, roster, excludedCount } = optionResult;

    try {
      const activity = await context.services.contestActivity.getContestActivityForRoster(
        roster,
        { lookbackDays: days, participantLimit: limit }
      );
      const scopeSummary =
        scope === "all"
          ? { contestCount: activity.contestCount, participantCount: activity.participantCount }
          : activity.byScope[scope];
      if (scopeSummary.contestCount === 0) {
        await interaction.editReply(
          `No contest activity for linked handles in the last ${days} days.`
        );
        return;
      }

      const embed = buildContestSummaryEmbedBase({
        title: "Contest activity",
        days,
        scope,
        color: EMBED_COLORS.info,
      }).addFields(
        { name: "Contests", value: String(scopeSummary.contestCount), inline: true },
        { name: "Participants", value: String(scopeSummary.participantCount), inline: true }
      );
      appendRosterExcludedField(embed, excludedCount);

      if (scope === "all") {
        embed.addFields({
          name: "By scope",
          value: [
            formatScopeSummary("Official", activity.byScope.official),
            formatScopeSummary("Gym", activity.byScope.gym),
          ].join("\n"),
          inline: false,
        });
      }

      if (activity.participants.length > 0) {
        const participantLines = buildParticipantLines(activity.participants, scope);
        if (participantLines) {
          embed.addFields({ name: "Top participants", value: participantLines, inline: false });
        }
      }

      if (activity.topContests.length > 0) {
        const filtered = filterRecentContests(activity.topContests, scope);
        if (filtered.length > 0) {
          const lines = filtered
            .map((contest) => formatContestLine(contest, contest.participantCount))
            .join("\n");
          embed.addFields({ name: "Top contests", value: lines, inline: false });
        }
      }

      if (activity.recentContests.length > 0) {
        const filtered = filterRecentContests(activity.recentContests, scope);
        if (filtered.length > 0) {
          const lines = filtered.map((contest) => formatContestLine(contest)).join("\n");
          embed.addFields({ name: "Recent contests", value: lines, inline: false });
        }
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contest activity: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
