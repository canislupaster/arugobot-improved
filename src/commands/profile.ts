import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logError } from "../utils/logger.js";

import type { Command } from "./types.js";

function buildProblemLine(
  problemId: string,
  name: string | null,
  contestId?: number,
  index?: string
) {
  if (name && contestId && index) {
    return `- [${problemId}. ${name}](https://codeforces.com/problemset/problem/${contestId}/${index})`;
  }
  return `- ${problemId}`;
}

export const profileCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Shows linked handle details and recent activity")
    .addUserOption((option) => option.setName("user").setDescription("User to inspect")),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }
    const member = interaction.options.getMember("user");
    const user = interaction.options.getUser("user") ?? interaction.user;
    const targetId = user.id;
    const targetName =
      member && "displayName" in member ? member.displayName : user.username;

    try {
      const handle = await context.services.store.getHandle(interaction.guild.id, targetId);
      if (!handle) {
        await interaction.reply({ content: "Handle not linked.", ephemeral: true });
        return;
      }

      const rating = await context.services.store.getRating(interaction.guild.id, targetId);
      const historyData = await context.services.store.getHistoryWithRatings(
        interaction.guild.id,
        targetId
      );
      const totalChallenges = historyData?.history.length ?? 0;
      const problemDict = context.services.problems.getProblemDict();
      const recent = historyData?.history.slice(-5) ?? [];

      const recentLines = recent
        .map((problemId) => {
          const problem = problemDict.get(problemId);
          return buildProblemLine(
            problemId,
            problem?.name ?? null,
            problem?.contestId,
            problem?.index
          );
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`Profile: ${targetName}`)
        .setColor(0x3498db)
        .addFields(
          { name: "Handle", value: handle, inline: true },
          { name: "Rating", value: rating >= 0 ? String(rating) : "Unknown", inline: true },
          { name: "Challenges", value: String(totalChallenges), inline: true },
          {
            name: "Recent problems",
            value: recentLines || "No challenges yet.",
            inline: false,
          }
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (error) {
      logError(`Error in profile: ${String(error)}`);
      await interaction.reply({ content: "Something went wrong.", ephemeral: true });
    }
  },
};
