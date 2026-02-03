import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { CommandContext } from "../types/commandContext.js";
import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { resolveHandleTargetWithOptionalGuild } from "../utils/handles.js";
import { resolveHandleTargetLabelsOrReply } from "../utils/interaction.js";
import { buildProblemUrl } from "../utils/problemReference.js";
import { formatRatingDelta } from "../utils/ratingChanges.js";
import { formatSubmissionLines } from "../utils/submissions.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_RECENT = 5;
const MAX_RECENT_CHALLENGES = 5;

type ChallengeProblemEntry = {
  problemId: string;
  name?: string | null;
  contestId?: number;
  index?: string;
};

type ChallengeStreakSummary = {
  currentStreak: number;
  longestStreak: number;
  totalSolvedDays: number;
  lastSolvedAt: string | null;
};

function buildProblemLine(entry: ChallengeProblemEntry) {
  if (entry.name && entry.contestId && entry.index) {
    return `- [${entry.problemId}. ${entry.name}](${buildProblemUrl(
      entry.contestId,
      entry.index
    )})`;
  }
  return `- ${entry.problemId}`;
}

function formatProblemLines(entries: ChallengeProblemEntry[]): string {
  return entries.map(buildProblemLine).join("\n");
}

async function loadFallbackChallengeEntries(
  guildId: string,
  linkedUserId: string,
  services: CommandContext["services"]
): Promise<{ totalChallenges: number; entries: ChallengeProblemEntry[] }> {
  const historyData = await services.store.getHistoryWithRatings(guildId, linkedUserId);
  if (!historyData || historyData.history.length === 0) {
    return { totalChallenges: 0, entries: [] };
  }

  const problemDict = services.problems.getProblemDict();
  const recent = historyData.history.slice(-MAX_RECENT_CHALLENGES);
  const entries = recent.map((problemId) => {
    const problem = problemDict.get(problemId);
    return {
      problemId,
      name: problem?.name ?? null,
      contestId: problem?.contestId,
      index: problem?.index,
    };
  });
  return { totalChallenges: historyData.history.length, entries };
}

async function loadChallengeSummary(
  guildId: string,
  linkedUserId: string,
  services: CommandContext["services"]
) {
  const [botRating, recentHistory, streak] = await Promise.all([
    services.store.getRating(guildId, linkedUserId),
    services.store.getChallengeHistoryPage(guildId, linkedUserId, 1, MAX_RECENT_CHALLENGES),
    services.store.getChallengeStreak(guildId, linkedUserId),
  ]);
  if (recentHistory.total > 0) {
    const recentEntries = recentHistory.entries.map((entry) => ({
      problemId: entry.problemId,
      name: entry.name,
      contestId: entry.contestId,
      index: entry.index,
    }));
    return {
      botRating,
      totalChallenges: recentHistory.total,
      recentLines: formatProblemLines(recentEntries),
      streak,
    };
  }

  const fallback = await loadFallbackChallengeEntries(guildId, linkedUserId, services);
  return {
    botRating,
    totalChallenges: fallback.totalChallenges,
    recentLines: formatProblemLines(fallback.entries),
    streak,
  };
}

async function loadRecentSubmissions(
  handle: string,
  services: CommandContext["services"]
) {
  const recent = await services.store.getRecentSubmissions(handle, MAX_RECENT);
  if (!recent) {
    return { lines: "Unable to fetch recent submissions right now.", isStale: false };
  }
  return {
    lines: formatSubmissionLines(recent.submissions),
    isStale: recent.isStale,
  };
}

function formatRatingSummary(
  value: number | null | undefined,
  rank: string | null | undefined,
  fallbackValue: string,
  fallbackRank: string
) {
  if (value !== null && value !== undefined) {
    return `${value} (${rank ?? fallbackRank})`;
  }
  return fallbackValue;
}

function formatStreakSummary(streak: ChallengeStreakSummary | null): string {
  if (!streak || streak.totalSolvedDays === 0) {
    return "No completed challenges yet.";
  }
  const parts = [
    `Current: ${streak.currentStreak}`,
    `Longest: ${streak.longestStreak}`,
    `Active: ${streak.totalSolvedDays}`,
  ];
  if (streak.lastSolvedAt) {
    const timestampSeconds = Math.floor(Date.parse(streak.lastSolvedAt) / 1000);
    if (Number.isFinite(timestampSeconds)) {
      parts.push(`Last: ${formatDiscordRelativeTime(timestampSeconds)}`);
    }
  }
  return parts.join(" • ");
}

function formatLastRatingChange(entry: {
  contestId: number;
  contestName: string;
  rank: number;
  oldRating: number;
  newRating: number;
  ratingUpdateTimeSeconds: number;
} | null): string {
  if (!entry) {
    return "No rated contests yet.";
  }
  const delta = formatRatingDelta(entry.newRating - entry.oldRating);
  const updatedAt = formatDiscordRelativeTime(entry.ratingUpdateTimeSeconds);
  return `${entry.contestName}\nRank: ${entry.rank}\nRating: ${entry.oldRating} -> ${entry.newRating} (${delta})\nUpdated: ${updatedAt}`;
}

type ProfileField = { name: string; value: string; inline: boolean };

function buildProfileFields(options: {
  displayHandle: string;
  linkedUserId: string | null;
  targetId: string;
  targetMention: string;
  botRating: number | null;
  totalChallenges: number;
  streakSummary: string;
  cfRating: string;
  cfMaxRating: string;
  cfLastOnline: string;
}): ProfileField[] {
  const fields: ProfileField[] = [{ name: "Handle", value: options.displayHandle, inline: true }];
  if (options.linkedUserId) {
    fields.push(
      {
        name: "Linked user",
        value:
          options.linkedUserId === options.targetId
            ? options.targetMention
            : `<@${options.linkedUserId}>`,
        inline: true,
      },
      {
        name: "Rating",
        value:
          options.botRating !== null && options.botRating >= 0
            ? String(options.botRating)
            : "Unknown",
        inline: true,
      },
      { name: "Challenges", value: String(options.totalChallenges), inline: true },
      { name: "Challenge streak", value: options.streakSummary, inline: true }
    );
  }
  fields.push(
    { name: "CF rating", value: options.cfRating, inline: true },
    { name: "CF max", value: options.cfMaxRating, inline: true },
    { name: "CF last online", value: options.cfLastOnline, inline: true }
  );
  return fields;
}

export const profileCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Shows linked handle details and recent activity")
    .addUserOption((option) => option.setName("user").setDescription("User to inspect"))
    .addStringOption((option) =>
      option.setName("handle").setDescription("Codeforces handle to inspect")
    ),
  async execute(interaction, context) {
    const labelResolution = await resolveHandleTargetLabelsOrReply(interaction);
    if (labelResolution.status === "replied") {
      return;
    }

    const { handleInput, targetId } = labelResolution;
    const { displayName: targetName, mention: targetMention } = labelResolution.labels;

    await interaction.deferReply();

    try {
      const guildId = interaction.guild?.id;
      const handleResolution = await resolveHandleTargetWithOptionalGuild(context.services.store, {
        guildId,
        targetId,
        handleInput,
        includeLinkedUserId: true,
      });
      if ("error" in handleResolution) {
        await interaction.editReply(handleResolution.error);
        return;
      }
      const { handle, linkedUserId } = handleResolution;

      const cfProfile = await context.services.store.getCodeforcesProfile(handle);
      if (!cfProfile) {
        await interaction.editReply("Unable to fetch Codeforces profile right now.");
        return;
      }

      const linkedGuildId = guildId && linkedUserId ? guildId : null;
      const hasLinkedUser = Boolean(linkedGuildId);
      const showSubmissions = handleInput.length > 0 || !linkedUserId;
      const [challengeSummary, recentSubmissions, ratingChanges] = await Promise.all([
        linkedGuildId
          ? loadChallengeSummary(linkedGuildId, linkedUserId ?? "", context.services)
          : Promise.resolve(null),
        showSubmissions ? loadRecentSubmissions(handle, context.services) : Promise.resolve(null),
        context.services.ratingChanges.getRatingChanges(handle),
      ]);

      const {
        botRating = null,
        totalChallenges = 0,
        recentLines = "",
        streak: streakSummary = null,
      } = challengeSummary ?? {};
      const { lines: recentSubmissionsLines = "", isStale: submissionsStale = false } =
        recentSubmissions ?? {};
      const lastRatingChange = ratingChanges?.changes.at(-1) ?? null;
      const ratingChangeLine = ratingChanges
        ? formatLastRatingChange(lastRatingChange)
        : "Rating history unavailable.";
      const ratingChangesStale = ratingChanges?.isStale ?? false;

      const displayHandle = cfProfile.profile.displayHandle;
      const cfRating = formatRatingSummary(
        cfProfile.profile.rating,
        cfProfile.profile.rank,
        "Unrated",
        "unrated"
      );
      const cfMaxRating = formatRatingSummary(
        cfProfile.profile.maxRating,
        cfProfile.profile.maxRank,
        "N/A",
        "unknown"
      );
      const cfLastOnline = cfProfile.profile.lastOnlineTimeSeconds
        ? formatDiscordRelativeTime(cfProfile.profile.lastOnlineTimeSeconds)
        : "Unknown";

      const title = handleInput ? `Profile: ${displayHandle}` : `Profile: ${targetName}`;
      const fields = buildProfileFields({
        displayHandle,
        linkedUserId,
        targetId,
        targetMention,
        botRating,
        totalChallenges,
        streakSummary: formatStreakSummary(streakSummary),
        cfRating,
        cfMaxRating,
        cfLastOnline,
      });

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(EMBED_COLORS.info)
        .addFields(fields);

      embed.addFields({ name: "Last rated contest", value: ratingChangeLine, inline: false });

      if (hasLinkedUser) {
        embed.addFields({
          name: "Recent problems",
          value: recentLines || "No challenges yet.",
          inline: false,
        });
      }

      if (showSubmissions) {
        embed.addFields({
          name: "Recent submissions",
          value: recentSubmissionsLines || "No recent submissions found.",
          inline: false,
        });
      }

      if (cfProfile.isStale || submissionsStale || ratingChangesStale) {
        embed.setFooter({ text: "Some Codeforces data may be stale." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in profile: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
