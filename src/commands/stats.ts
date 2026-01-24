import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { ephemeralFlags } from "../utils/discordFlags.js";

import type { Command } from "./types.js";

export const statsCommand: Command = {
  data: new SlashCommandBuilder().setName("stats").setDescription("Shows server challenge stats"),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ...ephemeralFlags,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const stats = await context.services.store.getServerStats(interaction.guild.id);
      if (stats.userCount === 0) {
        await interaction.editReply("No linked users yet.");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Server stats")
        .setColor(0x3498db)
        .addFields(
          { name: "Linked users", value: String(stats.userCount), inline: true },
          { name: "Total challenges", value: String(stats.totalChallenges), inline: true },
          {
            name: "Average rating",
            value: stats.avgRating === null ? "N/A" : String(stats.avgRating),
            inline: true,
          },
          {
            name: "Top rating",
            value: stats.topRating === null ? "N/A" : String(stats.topRating),
            inline: true,
          }
        );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in stats: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
