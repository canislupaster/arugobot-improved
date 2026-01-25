import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";
import { EMBED_COLORS } from "../utils/embedColors.js";

const MAX_RECENT = 10;

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

export const recentCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("recent")
    .setDescription("Shows recent Codeforces submissions for a linked user")
    .addUserOption((option) => option.setName("user").setDescription("User to inspect"))
    .addStringOption((option) =>
      option.setName("handle").setDescription("Codeforces handle to inspect")
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of submissions to show (1-${MAX_RECENT})`)
        .setMinValue(1)
        .setMaxValue(MAX_RECENT)
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
    const targetName = handleInput
      ? handleInput
      : member && "displayName" in member
        ? member.displayName
        : user.username;
    const limit = interaction.options.getInteger("limit") ?? MAX_RECENT;

    await interaction.deferReply();

    try {
      let handle = "";
      if (handleInput) {
        const handleInfo = await context.services.store.resolveHandle(handleInput);
        if (!handleInfo.exists) {
          await interaction.editReply("Invalid handle.");
          return;
        }
        handle = handleInfo.canonicalHandle ?? handleInput;
      } else {
        const linkedHandle = await context.services.store.getHandle(interaction.guild.id, targetId);
        if (!linkedHandle) {
          await interaction.editReply("Handle not linked.");
          return;
        }
        handle = linkedHandle;
      }

      const result = await context.services.store.getRecentSubmissions(handle, limit);
      if (!result) {
        await interaction.editReply("Unable to fetch recent submissions right now.");
        return;
      }
      if (result.submissions.length === 0) {
        await interaction.editReply("No recent submissions found.");
        return;
      }

      const lines = result.submissions.map(formatSubmissionLine).join("\n");
      const embed = new EmbedBuilder()
        .setTitle(`Recent submissions: ${targetName}`)
        .setColor(EMBED_COLORS.info)
        .addFields(
          { name: "Handle", value: handle, inline: true },
          { name: "Submissions", value: lines, inline: false }
        );

      if (result.isStale) {
        embed.setFooter({
          text: "Showing cached submissions due to a temporary Codeforces error.",
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in recent: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
