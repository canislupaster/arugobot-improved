import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { ContestScopeFilter } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  CONTEST_ACTIVITY_DEFAULTS,
  buildContestActivityOptionConfig,
  resolveContestActivityOptions,
} from "../utils/contestActivityOptions.js";
import { addContestScopeOption, formatContestScopeLabel } from "../utils/contestScope.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { resolveGuildRoster } from "../utils/roster.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

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

function formatContestLine(contest: {
  contestId: number;
  contestName: string;
  ratingUpdateTimeSeconds: number;
  scope: "official" | "gym";
}): string {
  const scopeLabel = contest.scope === "gym" ? "Gym" : "Official";
  return `${contest.contestName} (${contest.contestId}) • ${scopeLabel} • ${formatDiscordRelativeTime(
    contest.ratingUpdateTimeSeconds
  )}`;
}

function formatTopContestLine(contest: {
  contestId: number;
  contestName: string;
  participantCount: number;
  ratingUpdateTimeSeconds: number;
  scope: "official" | "gym";
}): string {
  const scopeLabel = contest.scope === "gym" ? "Gym" : "Official";
  return `${contest.contestName} (${contest.contestId}) • ${contest.participantCount} participants • ${scopeLabel} • ${formatDiscordRelativeTime(
    contest.ratingUpdateTimeSeconds
  )}`;
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
  data: new SlashCommandBuilder()
    .setName("contestactivity")
    .setDescription("Shows recent contest participation for this server")
    .addIntegerOption((option) =>
      option
        .setName("days")
        .setDescription(
          `Lookback window (${CONTEST_ACTIVITY_DEFAULTS.minDays}-${CONTEST_ACTIVITY_DEFAULTS.maxDays} days)`
        )
        .setMinValue(CONTEST_ACTIVITY_DEFAULTS.minDays)
        .setMaxValue(CONTEST_ACTIVITY_DEFAULTS.maxDays)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Top participants to show (1-${CONTEST_ACTIVITY_DEFAULTS.maxLimit})`)
        .setMinValue(1)
        .setMaxValue(CONTEST_ACTIVITY_DEFAULTS.maxLimit)
    )
    .addStringOption((option) =>
      addContestScopeOption(option, "Which contests to include", ["all", "official", "gym"])
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    const optionResult = resolveContestActivityOptions(
      interaction,
      buildContestActivityOptionConfig({
      daysErrorMessage: "Invalid lookback window.",
      limitErrorMessage: "Invalid participant limit.",
      })
    );
    if (optionResult.status === "error") {
      await interaction.reply({ content: optionResult.message });
      return;
    }
    const { days, limit, scope } = optionResult;

    await interaction.deferReply();

    try {
      const roster = await context.services.store.getServerRoster(interaction.guild.id);
      const rosterResult = await resolveGuildRoster(interaction.guild, roster, {
        correlationId: context.correlationId,
        command: interaction.commandName,
        guildId: interaction.guild.id,
        userId: interaction.user.id,
      });
      if (rosterResult.status === "empty") {
        await interaction.editReply(rosterResult.message);
        return;
      }
      const activity = await context.services.contestActivity.getContestActivityForRoster(
        rosterResult.roster,
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

      const embed = new EmbedBuilder()
        .setTitle("Contest activity")
        .setColor(EMBED_COLORS.info)
        .setDescription(`Last ${days} days • Scope: ${formatContestScopeLabel(scope)}`)
        .addFields(
          { name: "Contests", value: String(scopeSummary.contestCount), inline: true },
          { name: "Participants", value: String(scopeSummary.participantCount), inline: true }
        );

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
          const lines = filtered.map(formatTopContestLine).join("\n");
          embed.addFields({ name: "Top contests", value: lines, inline: false });
        }
      }

      if (activity.recentContests.length > 0) {
        const filtered = filterRecentContests(activity.recentContests, scope);
        if (filtered.length > 0) {
          const lines = filtered.map(formatContestLine).join("\n");
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
