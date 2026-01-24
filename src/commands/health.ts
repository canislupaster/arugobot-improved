import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  version as discordJsVersion,
} from "discord.js";

import { getCommandCount } from "../services/metrics.js";
import { getLastError } from "../utils/logger.js";

import type { Command } from "./types.js";

export const healthCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("health")
    .setDescription("Shows diagnostics for this bot instance")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  adminOnly: true,
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }
    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();
    const dbOk = await context.services.store.checkDb();
    const lastError = getLastError();
    const cfLastError = context.services.codeforces.getLastError();
    const cfLastSuccessAt = context.services.codeforces.getLastSuccessAt();
    const lastRefreshAt = context.services.problems.getLastRefreshAt();
    const contestRefreshAt = context.services.contests.getLastRefreshAt();
    const contestLastError = context.services.contests.getLastError();
    const reminderCount = await context.services.contestReminders.getSubscriptionCount();
    const reminderLastTick = context.services.contestReminders.getLastTickAt();
    const reminderLastError = context.services.contestReminders.getLastError();
    const practiceReminderCount = await context.services.practiceReminders.getSubscriptionCount();
    const practiceReminderLastTick = context.services.practiceReminders.getLastTickAt();
    const practiceReminderLastError = context.services.practiceReminders.getLastError();
    const activeChallenges = await context.services.challenges.getActiveCount();
    const challengeLastTick = context.services.challenges.getLastTickAt();
    const challengeLastError = context.services.challenges.getLastError();
    const cacheAgeSeconds =
      lastRefreshAt > 0 ? Math.floor((Date.now() - lastRefreshAt) / 1000) : null;
    const contestCacheAgeSeconds =
      contestRefreshAt > 0 ? Math.floor((Date.now() - contestRefreshAt) / 1000) : null;

    const embed = new EmbedBuilder()
      .setTitle("ArugoBot Health")
      .setColor(0x3498db)
      .addFields(
        { name: "Uptime", value: `${uptimeSeconds}s`, inline: true },
        { name: "Memory", value: `${Math.round(memory.rss / 1024 / 1024)} MB`, inline: true },
        { name: "DB", value: dbOk ? "OK" : "Failed", inline: true },
        {
          name: "Problem cache age",
          value: cacheAgeSeconds === null ? "Unknown" : `${cacheAgeSeconds}s`,
          inline: true,
        },
        {
          name: "Contest cache age",
          value: contestCacheAgeSeconds === null ? "Unknown" : `${contestCacheAgeSeconds}s`,
          inline: true,
        },
        { name: "Contest reminders", value: String(reminderCount), inline: true },
        { name: "Practice reminders", value: String(practiceReminderCount), inline: true },
        { name: "Active challenges", value: String(activeChallenges), inline: true },
        { name: "Commands handled", value: String(getCommandCount()), inline: true },
        { name: "Node", value: process.version, inline: true },
        { name: "discord.js", value: discordJsVersion, inline: true },
        { name: "Bot version", value: process.env.npm_package_version ?? "unknown", inline: true }
      );

    if (lastError) {
      embed.addFields({
        name: "Last error",
        value: `${lastError.timestamp} - ${lastError.message}`,
        inline: false,
      });
    }
    if (cfLastError) {
      embed.addFields({
        name: "Codeforces last error",
        value: `${cfLastError.timestamp} - ${cfLastError.message}`,
        inline: false,
      });
    }
    if (contestLastError) {
      embed.addFields({
        name: "Contest cache last error",
        value: `${contestLastError.timestamp} - ${contestLastError.message}`,
        inline: false,
      });
    }
    if (reminderLastError) {
      embed.addFields({
        name: "Contest reminders last error",
        value: `${reminderLastError.timestamp} - ${reminderLastError.message}`,
        inline: false,
      });
    }
    if (practiceReminderLastError) {
      embed.addFields({
        name: "Practice reminders last error",
        value: `${practiceReminderLastError.timestamp} - ${practiceReminderLastError.message}`,
        inline: false,
      });
    }
    if (challengeLastError) {
      embed.addFields({
        name: "Challenge loop last error",
        value: `${challengeLastError.timestamp} - ${challengeLastError.message}`,
        inline: false,
      });
    }
    if (cfLastSuccessAt) {
      embed.addFields({
        name: "Codeforces last success",
        value: cfLastSuccessAt,
        inline: false,
      });
    }
    if (challengeLastTick) {
      embed.addFields({
        name: "Challenge loop last tick",
        value: challengeLastTick,
        inline: false,
      });
    }
    if (reminderLastTick) {
      embed.addFields({
        name: "Contest reminders last tick",
        value: reminderLastTick,
        inline: false,
      });
    }
    if (practiceReminderLastTick) {
      embed.addFields({
        name: "Practice reminders last tick",
        value: practiceReminderLastTick,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
