import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { CommandContext } from "../types/commandContext.js";
import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { formatSubmissionLine } from "../utils/submissions.js";

import type { Command } from "./types.js";

const MAX_RECENT = 10;

type HandleResolution = { handle: string } | { error: string };

function resolveTargetName(handleInput: string, user: { username: string }, member: unknown): string {
  if (handleInput) {
    return handleInput;
  }
  if (member && typeof member === "object" && "displayName" in member) {
    const displayName = (member as { displayName?: string }).displayName;
    if (displayName) {
      return displayName;
    }
  }
  return user.username;
}

async function resolveHandle(
  context: CommandContext,
  guildId: string,
  targetId: string,
  handleInput: string
): Promise<HandleResolution> {
  if (handleInput) {
    const handleInfo = await context.services.store.resolveHandle(handleInput);
    if (!handleInfo.exists) {
      return { error: "Invalid handle." };
    }
    return { handle: handleInfo.canonicalHandle ?? handleInput };
  }

  const linkedHandle = await context.services.store.getHandle(guildId, targetId);
  if (!linkedHandle) {
    return { error: "Handle not linked." };
  }
  return { handle: linkedHandle };
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
    const targetName = resolveTargetName(handleInput, user, member);
    const limit = interaction.options.getInteger("limit") ?? MAX_RECENT;

    await interaction.deferReply();

    try {
      const resolution = await resolveHandle(
        context,
        interaction.guild.id,
        targetId,
        handleInput
      );
      if ("error" in resolution) {
        await interaction.editReply(resolution.error);
        return;
      }

      const handle = resolution.handle;
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
