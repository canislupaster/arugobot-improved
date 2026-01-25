import { SlashCommandBuilder } from "discord.js";

import type { Command } from "./types.js";

export const pingCommand: Command = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Pings the bot"),
  async execute(interaction) {
    await interaction.reply({ content: "Pong!" });
  },
};
