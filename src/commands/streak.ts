import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

export const streakCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("streak")
    .setDescription("Shows challenge streaks for a user")
    .addUserOption((option) => option.setName("user").setDescription("User to inspect")),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    const user = interaction.options.getUser("user") ?? interaction.user;
    const member = interaction.options.getMember("user");
    const targetName = member && "displayName" in member ? member.displayName : user.username;
    const targetMention = member && "toString" in member ? member.toString() : user.toString();

    await interaction.deferReply();

    try {
      const streak = await context.services.store.getChallengeStreak(interaction.guild.id, user.id);
      if (streak.totalSolvedDays === 0) {
        await interaction.editReply(`No completed challenges yet for ${targetMention}.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Challenge streak: ${targetName}`)
        .setColor(EMBED_COLORS.info)
        .setDescription(`Counts UTC days with at least one solved challenge for ${targetMention}.`)
        .addFields(
          { name: "Current streak", value: `${streak.currentStreak} days`, inline: true },
          { name: "Longest streak", value: `${streak.longestStreak} days`, inline: true },
          { name: "Active days", value: String(streak.totalSolvedDays), inline: true }
        );

      if (streak.lastSolvedAt) {
        const timestampSeconds = Math.floor(Date.parse(streak.lastSolvedAt) / 1000);
        if (Number.isFinite(timestampSeconds)) {
          embed.addFields({
            name: "Last solved",
            value: formatDiscordRelativeTime(timestampSeconds),
            inline: false,
          });
        }
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in streak: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
