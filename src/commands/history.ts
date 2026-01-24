import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { formatTime } from "../utils/rating.js";

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

    await interaction.deferReply({ ephemeral: true });

    try {
      const historyPage = await context.services.store.getChallengeHistoryPage(
        interaction.guild.id,
        interaction.user.id,
        page,
        10
      );

      if (historyPage.total > 0) {
        if (historyPage.entries.length === 0) {
          await interaction.editReply("Empty page.");
          return;
        }
        const lines = historyPage.entries.map((entry) => {
          const duration =
            entry.solvedAt === null
              ? "Not solved"
              : `Solved in ${formatTime(Math.max(0, entry.solvedAt - entry.startedAt))}`;
          const delta =
            entry.ratingDelta === null
              ? "N/A"
              : entry.ratingDelta > 0
                ? `+${entry.ratingDelta}`
                : String(entry.ratingDelta);
          return `- [${entry.problemId}. ${entry.name}](https://codeforces.com/problemset/problem/${entry.contestId}/${entry.index}) • ${duration} • ${delta}`;
        });

        const embed = new EmbedBuilder()
          .setTitle("History")
          .setDescription(`Page ${page}`)
          .setColor(0x3498db)
          .addFields({ name: "Challenges", value: lines.join("\n"), inline: false });

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const historyData = await context.services.store.getHistoryWithRatings(
        interaction.guild.id,
        interaction.user.id
      );
      if (!historyData) {
        await interaction.editReply("No history yet.");
        return;
      }
      const problemDict = context.services.problems.getProblemDict();
      if (problemDict.size === 0) {
        await interaction.editReply("Problem cache not ready yet.");
        return;
      }
      const start = (page - 1) * 10;
      if (start >= historyData.history.length) {
        await interaction.editReply("Empty page.");
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
        const previous = historyData.ratingHistory[index];
        const next = historyData.ratingHistory[index + 1];
        const delta = Number.isFinite(previous) && Number.isFinite(next) ? next - previous : null;
        const deltaLabel = delta === null ? "N/A" : String(delta);
        content += `- [${problemId}. ${problem.name}](https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}) (rating change: ${deltaLabel})\n`;
      }

      const embed = new EmbedBuilder()
        .setTitle("History")
        .setDescription(`Page ${page}`)
        .setColor(0x3498db)
        .addFields({ name: "Problems", value: content || "No entries.", inline: false });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in history: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
