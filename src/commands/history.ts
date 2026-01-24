import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logError } from "../utils/logger.js";

import type { Command } from "./types.js";

export const historyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Shows your challenge history")
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number (starting at 1)").setMinValue(1)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }
    const page = interaction.options.getInteger("page") ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      await interaction.reply({ content: "Invalid page.", ephemeral: true });
      return;
    }

    try {
      const historyData = await context.services.store.getHistoryWithRatings(
        interaction.guild.id,
        interaction.user.id
      );
      if (!historyData) {
        await interaction.reply({ content: "No history yet.", ephemeral: true });
        return;
      }
      const problemDict = context.services.problems.getProblemDict();
      if (problemDict.size === 0) {
        await interaction.reply({ content: "Problem cache not ready yet.", ephemeral: true });
        return;
      }
      const start = (page - 1) * 10;
      if (start >= historyData.history.length) {
        await interaction.reply({ content: "Empty page.", ephemeral: true });
        return;
      }

      let content = "";
      for (let i = 0; i < 10; i += 1) {
        const index = start + i;
        if (index >= historyData.history.length) {
          break;
        }
        const problemId = historyData.history[index];
        const problem = problemDict.get(problemId);
        if (!problem) {
          continue;
        }
        const delta = historyData.ratingHistory[index + 1] - historyData.ratingHistory[index];
        content += `- [${problemId}. ${problem.name}](https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}) (rating change: ${delta})\n`;
      }

      const embed = new EmbedBuilder()
        .setTitle("History")
        .setDescription(`Page ${page}`)
        .setColor(0x3498db)
        .addFields({ name: "Problems", value: content || "No entries.", inline: false });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (error) {
      logError(`Error in history: ${String(error)}`);
      await interaction.reply({ content: "Something went wrong.", ephemeral: true });
    }
  },
};
