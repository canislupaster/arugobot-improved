import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { ephemeralFlags } from "../utils/discordFlags.js";

import type { Command } from "./types.js";

const PAGE_SIZE = 10;

export const handlesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("handles")
    .setDescription("Lists linked Codeforces handles for this server")
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number (starting at 1)").setMinValue(1)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ...ephemeralFlags,
      });
      return;
    }
    const page = interaction.options.getInteger("page") ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      await interaction.reply({ content: "Invalid page.", ...ephemeralFlags });
      return;
    }

    await interaction.deferReply();

    try {
      const roster = await context.services.store.getServerRoster(interaction.guild.id);
      if (roster.length === 0) {
        await interaction.editReply("No linked handles yet.");
        return;
      }

      const start = (page - 1) * PAGE_SIZE;
      if (start >= roster.length) {
        await interaction.editReply("Empty page.");
        return;
      }

      const lines = roster
        .slice(start, start + PAGE_SIZE)
        .map(
          (entry, index) =>
            `${start + index + 1}. <@${entry.userId}> - ${entry.handle} (${entry.rating})`
        )
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("Linked handles")
        .setDescription(`Page ${page}`)
        .setColor(0x3498db)
        .addFields({ name: "Users", value: lines || "No entries.", inline: false });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in handles: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
