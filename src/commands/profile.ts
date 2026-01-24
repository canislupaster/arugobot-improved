import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_RECENT = 5;

function buildProblemLine(
  problemId: string,
  name: string | null,
  contestId?: number,
  index?: string
) {
  if (name && contestId && index) {
    return `- [${problemId}. ${name}](https://codeforces.com/problemset/problem/${contestId}/${index})`;
  }
  return `- ${problemId}`;
}

function formatSubmissionLine(submission: {
  contestId: number | null;
  index: string;
  name: string;
  verdict: string | null;
  creationTimeSeconds: number;
}) {
  const verdict = submission.verdict ?? "UNKNOWN";
  const when = formatDiscordRelativeTime(submission.creationTimeSeconds);
  if (submission.contestId) {
    return `- [${submission.index}. ${submission.name}](https://codeforces.com/problemset/problem/${submission.contestId}/${submission.index}) • ${verdict} • ${when}`;
  }
  return `- ${submission.index}. ${submission.name} • ${verdict} • ${when}`;
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
        ephemeral: true,
      });
      return;
    }
    const handleInput = interaction.options.getString("handle")?.trim() ?? "";
    const userOption = interaction.options.getUser("user");
    const member = interaction.options.getMember("user");

    if (handleInput && userOption) {
      await interaction.reply({
        content: "Provide either a handle or a user, not both.",
        ephemeral: true,
      });
      return;
    }

    const user = userOption ?? interaction.user;
    const targetId = user.id;
    const targetName = member && "displayName" in member ? member.displayName : user.username;
    const targetMention = member && "toString" in member ? member.toString() : user.toString();

    await interaction.deferReply({ ephemeral: true });

    try {
      const guildId = interaction.guild.id;
      let handle = "";
      let linkedUserId: string | null = null;

      if (handleInput) {
        const handleInfo = await context.services.store.resolveHandle(handleInput);
        if (!handleInfo.exists) {
          await interaction.editReply("Invalid handle.");
          return;
        }
        handle = handleInfo.canonicalHandle ?? handleInput;
        linkedUserId = await context.services.store.getUserIdByHandle(guildId, handle);
      } else {
        const linkedHandle = await context.services.store.getHandle(guildId, targetId);
        if (!linkedHandle) {
          await interaction.editReply("Handle not linked.");
          return;
        }
        handle = linkedHandle;
        linkedUserId = targetId;
      }

      const cfProfile = await context.services.store.getCodeforcesProfile(handle);
      if (!cfProfile) {
        await interaction.editReply("Unable to fetch Codeforces profile right now.");
        return;
      }

      let totalChallenges = 0;
      let recentLines = "";
      let botRating: number | null = null;

      if (linkedUserId) {
        botRating = await context.services.store.getRating(guildId, linkedUserId);
        const recentHistory = await context.services.store.getChallengeHistoryPage(
          guildId,
          linkedUserId,
          1,
          5
        );
        totalChallenges = recentHistory.total;
        recentLines = recentHistory.entries
          .map((entry) =>
            buildProblemLine(entry.problemId, entry.name, entry.contestId, entry.index)
          )
          .join("\n");

        if (totalChallenges === 0) {
          const historyData = await context.services.store.getHistoryWithRatings(
            guildId,
            linkedUserId
          );
          totalChallenges = historyData?.history.length ?? 0;
          const problemDict = context.services.problems.getProblemDict();
          const recent = historyData?.history.slice(-5) ?? [];
          recentLines = recent
            .map((problemId) => {
              const problem = problemDict.get(problemId);
              return buildProblemLine(
                problemId,
                problem?.name ?? null,
                problem?.contestId,
                problem?.index
              );
            })
            .join("\n");
        }
      }

      let recentSubmissionsLines = "";
      let submissionsStale = false;
      if (handleInput || !linkedUserId) {
        const recent = await context.services.store.getRecentSubmissions(handle, MAX_RECENT);
        if (recent) {
          submissionsStale = recent.isStale;
          recentSubmissionsLines = recent.submissions.map(formatSubmissionLine).join("\n");
        } else {
          recentSubmissionsLines = "Unable to fetch recent submissions right now.";
        }
      }

      const displayHandle = cfProfile.profile.displayHandle;
      const cfRating =
        cfProfile.profile.rating !== null && cfProfile.profile.rating !== undefined
          ? `${cfProfile.profile.rating} (${cfProfile.profile.rank ?? "unrated"})`
          : "Unrated";
      const cfMaxRating =
        cfProfile.profile.maxRating !== null && cfProfile.profile.maxRating !== undefined
          ? `${cfProfile.profile.maxRating} (${cfProfile.profile.maxRank ?? "unknown"})`
          : "N/A";
      const cfLastOnline = cfProfile.profile.lastOnlineTimeSeconds
        ? formatDiscordRelativeTime(cfProfile.profile.lastOnlineTimeSeconds)
        : "Unknown";

      const title = handleInput ? `Profile: ${displayHandle}` : `Profile: ${targetName}`;
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0x3498db)
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
