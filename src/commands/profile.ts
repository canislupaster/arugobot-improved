import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { CommandContext } from "../types/commandContext.js";
import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { resolveTargetLabels } from "../utils/interaction.js";
import { resolveHandleTarget } from "../utils/handles.js";
import { formatSubmissionLine } from "../utils/submissions.js";
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

function buildProblemLine(entry: ChallengeProblemEntry) {
  if (entry.name && entry.contestId && entry.index) {
    return `- [${entry.problemId}. ${entry.name}](https://codeforces.com/problemset/problem/${entry.contestId}/${entry.index})`;
  }
  return `- ${entry.problemId}`;
}

function formatProblemLines(entries: ChallengeProblemEntry[]): string {
  return entries.map(buildProblemLine).join("\n");
}

async function loadChallengeSummary(
  guildId: string,
  linkedUserId: string,
  services: CommandContext["services"]
) {
  const botRating = await services.store.getRating(guildId, linkedUserId);
  const recentHistory = await services.store.getChallengeHistoryPage(
    guildId,
    linkedUserId,
    1,
    MAX_RECENT_CHALLENGES
  );
  let totalChallenges = recentHistory.total;
  let recentEntries: ChallengeProblemEntry[] = recentHistory.entries.map((entry) => ({
    problemId: entry.problemId,
    name: entry.name,
    contestId: entry.contestId,
    index: entry.index,
  }));

  if (totalChallenges === 0) {
    const historyData = await services.store.getHistoryWithRatings(guildId, linkedUserId);
    totalChallenges = historyData?.history.length ?? 0;
    const problemDict = services.problems.getProblemDict();
    const recent = historyData?.history.slice(-MAX_RECENT_CHALLENGES) ?? [];
    recentEntries = recent.map((problemId) => {
      const problem = problemDict.get(problemId);
      return {
        problemId,
        name: problem?.name ?? null,
        contestId: problem?.contestId,
        index: problem?.index,
      };
    });
  }

  const recentLines = formatProblemLines(recentEntries);
  return { botRating, totalChallenges, recentLines };
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
    lines: recent.submissions.map(formatSubmissionLine).join("\n"),
    isStale: recent.isStale,
  };
}

async function loadOptional<T>(
  enabled: boolean,
  loader: () => Promise<T>
): Promise<T | null> {
  if (!enabled) {
    return null;
  }
  return loader();
}

function formatRatingSummary(value: number | null | undefined, rank: string | null | undefined) {
  if (value !== null && value !== undefined) {
    return `${value} (${rank ?? "unrated"})`;
  }
  return "Unrated";
}

function formatMaxRatingSummary(
  value: number | null | undefined,
  rank: string | null | undefined
) {
  if (value !== null && value !== undefined) {
    return `${value} (${rank ?? "unknown"})`;
  }
  return "N/A";
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
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }
    const handleInput = interaction.options.getString("handle")?.trim() ?? "";
    const userOption = interaction.options.getUser("user");
    const member = interaction.options.getMember("user");

    if (handleInput && userOption) {
      await interaction.reply({
        content: "Provide either a handle or a user, not both.",
      });
      return;
    }

    const user = userOption ?? interaction.user;
    const targetId = user.id;
    const { displayName: targetName, mention: targetMention } = resolveTargetLabels(user, member);

    await interaction.deferReply();

    try {
      const guildId = interaction.guild.id;
      const targetResolution = await resolveHandleTarget(context.services.store, {
        guildId,
        targetId,
        handleInput,
        includeLinkedUserId: true,
      });
      if ("error" in targetResolution) {
        await interaction.editReply(targetResolution.error);
        return;
      }
      const { handle, linkedUserId } = targetResolution;

      const cfProfile = await context.services.store.getCodeforcesProfile(handle);
      if (!cfProfile) {
        await interaction.editReply("Unable to fetch Codeforces profile right now.");
        return;
      }

      const [challengeSummary, recentSubmissions] = await Promise.all([
        loadOptional(!!linkedUserId, () =>
          loadChallengeSummary(guildId, linkedUserId ?? "", context.services)
        ),
        loadOptional(handleInput.length > 0 || !linkedUserId, () =>
          loadRecentSubmissions(handle, context.services)
        ),
      ]);

      const botRating = challengeSummary?.botRating ?? null;
      const totalChallenges = challengeSummary?.totalChallenges ?? 0;
      const recentLines = challengeSummary?.recentLines ?? "";
      const recentSubmissionsLines = recentSubmissions?.lines ?? "";
      const submissionsStale = recentSubmissions?.isStale ?? false;

      const displayHandle = cfProfile.profile.displayHandle;
      const cfRating = formatRatingSummary(cfProfile.profile.rating, cfProfile.profile.rank);
      const cfMaxRating = formatMaxRatingSummary(
        cfProfile.profile.maxRating,
        cfProfile.profile.maxRank
      );
      const cfLastOnline = cfProfile.profile.lastOnlineTimeSeconds
        ? formatDiscordRelativeTime(cfProfile.profile.lastOnlineTimeSeconds)
        : "Unknown";

      const title = handleInput ? `Profile: ${displayHandle}` : `Profile: ${targetName}`;
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(EMBED_COLORS.info)
        .addFields(
          { name: "Handle", value: displayHandle, inline: true },
          ...(linkedUserId
            ? [
                {
                  name: "Linked user",
                  value: linkedUserId === targetId ? targetMention : `<@${linkedUserId}>`,
                  inline: true,
                },
              ]
            : []),
          ...(linkedUserId
            ? [
                {
                  name: "Rating",
                  value: botRating !== null && botRating >= 0 ? String(botRating) : "Unknown",
                  inline: true,
                },
                { name: "Challenges", value: String(totalChallenges), inline: true },
              ]
            : []),
          { name: "CF rating", value: cfRating, inline: true },
          { name: "CF max", value: cfMaxRating, inline: true },
          { name: "CF last online", value: cfLastOnline, inline: true }
        );

      if (linkedUserId) {
        embed.addFields({
          name: "Recent problems",
          value: recentLines || "No challenges yet.",
          inline: false,
        });
      }

      if (handleInput || !linkedUserId) {
        embed.addFields({
          name: "Recent submissions",
          value: recentSubmissionsLines || "No recent submissions found.",
          inline: false,
        });
      }

      if (cfProfile.isStale || submissionsStale) {
        embed.setFooter({ text: "Some Codeforces data may be stale." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in profile: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
