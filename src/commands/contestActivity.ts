import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { ContestScopeFilter } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import { addContestScopeOption, parseContestScope } from "../utils/contestScope.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";
import { resolveBoundedIntegerOption } from "../utils/interaction.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_DAYS = 90;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const DEFAULT_SCOPE: ContestScopeFilter = "all";

function formatScope(scope: ContestScopeFilter): string {
  return scope === "official" ? "Official" : scope === "gym" ? "Gym" : "All";
}

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
        .setDescription(`Lookback window (${MIN_DAYS}-${MAX_DAYS} days)`)
        .setMinValue(MIN_DAYS)
        .setMaxValue(MAX_DAYS)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Top participants to show (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
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

    const scope = parseContestScope(interaction.options.getString("scope"), DEFAULT_SCOPE);
    const daysResult = resolveBoundedIntegerOption(interaction, {
      name: "days",
      min: MIN_DAYS,
      max: MAX_DAYS,
      defaultValue: DEFAULT_DAYS,
      errorMessage: "Invalid lookback window.",
    });
    if ("error" in daysResult) {
      await interaction.reply({ content: daysResult.error });
      return;
    }
    const limitResult = resolveBoundedIntegerOption(interaction, {
      name: "limit",
      min: 1,
      max: MAX_LIMIT,
      defaultValue: DEFAULT_LIMIT,
      errorMessage: "Invalid participant limit.",
    });
    if ("error" in limitResult) {
      await interaction.reply({ content: limitResult.error });
      return;
    }
    const { value: days } = daysResult;
    const { value: limit } = limitResult;

    await interaction.deferReply();

    try {
      const roster = await context.services.store.getServerRoster(interaction.guild.id);
      const filteredRoster = await filterEntriesByGuildMembers(interaction.guild, roster, {
        correlationId: context.correlationId,
        command: interaction.commandName,
        guildId: interaction.guild.id,
        userId: interaction.user.id,
      });
      const activity = await context.services.contestActivity.getContestActivityForRoster(
        filteredRoster,
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
        .setDescription(`Last ${days} days • Scope: ${formatScope(scope)}`)
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
