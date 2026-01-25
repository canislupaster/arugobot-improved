import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Command } from "./types.js";

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Shows the list of available commands"),
  async execute(interaction, context) {
    const description = context.commandSummaries
      .map((command) => `**/${command.name}** - ${command.description}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("ArugoBot Commands")
      .setDescription(description)
      .setColor(0x3498db);

    await interaction.reply({ embeds: [embed] });
  },
};
