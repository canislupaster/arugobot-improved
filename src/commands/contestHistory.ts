import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { resolveHandleTargetWithOptionalGuild } from "../utils/handles.js";
import { resolveHandleUserOptions } from "../utils/interaction.js";
import { formatRatingDelta } from "../utils/ratingChanges.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function clampLimit(limit: number): number {
  return Math.min(Math.max(limit, 1), MAX_LIMIT);
}

export const contestHistoryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contesthistory")
    .setDescription("Shows recent Codeforces contest rating changes")
    .addUserOption((option) => option.setName("user").setDescription("User to inspect"))
    .addStringOption((option) =>
      option.setName("handle").setDescription("Codeforces handle to inspect")
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of contests to show (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    ),
  async execute(interaction, context) {
    const handleResolution = resolveHandleUserOptions(interaction);
    if (handleResolution.error) {
      await interaction.reply({ content: handleResolution.error });
      return;
    }
    const { handleInput, userOption } = handleResolution;
    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;

    if (!interaction.guild && !handleInput) {
      await interaction.reply({
        content: "Run this command in a server or provide a handle.",
      });
      return;
    }

    await interaction.deferReply();

    try {
      const targetUser = userOption ?? interaction.user;
      const handleResult = await resolveHandleTargetWithOptionalGuild(
        context.services.store,
        {
          guildId: interaction.guild?.id ?? null,
          targetId: targetUser.id,
          handleInput,
        }
      );
      if ("error" in handleResult) {
        await interaction.editReply(handleResult.error);
        return;
      }

      const changesResult = await context.services.ratingChanges.getRatingChanges(
        handleResult.handle
      );
      if (!changesResult) {
        await interaction.editReply("Unable to fetch contest history right now.");
        return;
      }

      if (changesResult.changes.length === 0) {
        await interaction.editReply("No rated contests found for this handle.");
        return;
      }

      const sorted = [...changesResult.changes].sort(
        (a, b) => b.ratingUpdateTimeSeconds - a.ratingUpdateTimeSeconds
      );
      const entries = sorted.slice(0, clampLimit(limit));

      const lines = entries.map((entry) => {
        const delta = entry.newRating - entry.oldRating;
        const when = formatDiscordRelativeTime(entry.ratingUpdateTimeSeconds);
        return `- **${entry.contestName}** • ${entry.oldRating} → ${
          entry.newRating
        } (${formatRatingDelta(delta)}) • rank ${entry.rank} • ${when}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`Contest history: ${handleResult.handle}`)
        .setColor(EMBED_COLORS.info)
        .setDescription(lines.join("\n"));

      if (changesResult.isStale) {
        embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contesthistory: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
