import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Command } from "./types.js";
import { EMBED_COLORS } from "../utils/embedColors.js";

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
      .setColor(EMBED_COLORS.info);

    await interaction.reply({ embeds: [embed] });
  },
};
