import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";

import type { Command } from "./types.js";

export const leaderboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Shows the server leaderboard")
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number (starting at 1)").setMinValue(1)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }
    const page = interaction.options.getInteger("page") ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      await interaction.reply({ content: "Invalid page.", ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      const leaderboard = await context.services.store.getLeaderboard(interaction.guild.id);
      if (!leaderboard) {
        await interaction.editReply("No leaderboard entries yet.");
        return;
      }
      const start = (page - 1) * 10;
      if (start >= leaderboard.length) {
        await interaction.editReply("Empty page.");
        return;
      }

      let content = "";
      for (let i = 0; i < 10; i += 1) {
        const index = start + i;
        if (index >= leaderboard.length) {
          break;
        }
        const entry = leaderboard[index];
        const member = await interaction.guild.members.fetch(entry.userId).catch(() => null);
        const mention = member ? member.toString() : `<@${entry.userId}>`;
        content += `${index + 1}. ${mention} (${entry.rating})`;
        if (index === 0) {
          content += " :first_place:\n";
        } else if (index === 1) {
          content += " :second_place:\n";
        } else if (index === 2) {
          content += " :third_place:\n";
        } else {
          content += "\n";
        }
      }

      const embed = new EmbedBuilder()
        .setTitle("Leaderboard")
        .setDescription(`Page ${page}`)
        .setColor(0x3498db)
        .addFields({ name: "Users", value: content || "No entries.", inline: false });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error during leaderboard command: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
