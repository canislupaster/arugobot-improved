import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  version as discordJsVersion,
} from "discord.js";

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
    const problemLastError = context.services.problems.getLastError();
    const contestRefreshAt = context.services.contests.getLastRefreshAt();
    const contestLastError = context.services.contests.getLastError();
    const contestRatingChangesLastError = context.services.contestRatingChanges.getLastError();
    const ratingChangesLastError = context.services.ratingChanges.getLastError();
    const [
      reminderCount,
      ratingAlertCount,
      practiceReminderCount,
      activeChallenges,
      activeTournaments,
      recapCount,
      commandCount,
      uniqueCommandCount,
      lastCommandAt,
      topCommands,
    ] = await Promise.all([
      context.services.contestReminders.getSubscriptionCount(),
      context.services.contestRatingAlerts.getSubscriptionCount(),
      context.services.practiceReminders.getSubscriptionCount(),
      context.services.challenges.getActiveCount(),
      context.services.tournaments.getActiveCount(),
      context.services.tournamentRecaps.getSubscriptionCount(),
      context.services.metrics.getCommandCount(),
      context.services.metrics.getUniqueCommandCount(),
      context.services.metrics.getLastCommandAt(),
      context.services.metrics.getCommandUsageSummary(5),
    ]);

    const reminderLastTick = context.services.contestReminders.getLastTickAt();
    const reminderLastError = context.services.contestReminders.getLastError();
    const ratingAlertLastTick = context.services.contestRatingAlerts.getLastTickAt();
    const ratingAlertLastError = context.services.contestRatingAlerts.getLastError();
    const practiceReminderLastTick = context.services.practiceReminders.getLastTickAt();
    const practiceReminderLastError = context.services.practiceReminders.getLastError();
    const challengeLastTick = context.services.challenges.getLastTickAt();
    const challengeLastError = context.services.challenges.getLastError();
    const tournamentLastError = context.services.tournaments.getLastError();
    const recapLastError = context.services.tournamentRecaps.getLastError();
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
        { name: "Contest rating alerts", value: String(ratingAlertCount), inline: true },
        { name: "Practice reminders", value: String(practiceReminderCount), inline: true },
        { name: "Active challenges", value: String(activeChallenges), inline: true },
        { name: "Active tournaments", value: String(activeTournaments), inline: true },
        { name: "Tournament recaps", value: String(recapCount), inline: true },
        { name: "Commands handled", value: String(commandCount), inline: true },
        { name: "Unique commands", value: String(uniqueCommandCount), inline: true },
        { name: "Node", value: process.version, inline: true },
        { name: "discord.js", value: discordJsVersion, inline: true },
        { name: "Bot version", value: process.env.npm_package_version ?? "unknown", inline: true }
      );

    if (lastCommandAt) {
      embed.addFields({ name: "Last command", value: lastCommandAt, inline: true });
    }

    if (topCommands.length > 0) {
      const lines = topCommands
        .map(
          (entry) =>
            `/${entry.name}: ${entry.count} (avg ${entry.avgLatencyMs}ms, ok ${entry.successRate}%)`
        )
        .join("\n");
      embed.addFields({ name: "Top commands", value: lines, inline: false });
    }

    if (lastError) {
      embed.addFields({
        name: "Last error",
        value: `${lastError.timestamp} - ${lastError.message}`,
        inline: false,
      });
    }
    if (problemLastError) {
      embed.addFields({
        name: "Problem cache last error",
        value: `${problemLastError.timestamp} - ${problemLastError.message}`,
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
    if (contestRatingChangesLastError) {
      embed.addFields({
        name: "Contest rating changes last error",
        value: `${contestRatingChangesLastError.timestamp} - ${contestRatingChangesLastError.message}`,
        inline: false,
      });
    }
    if (ratingChangesLastError) {
      embed.addFields({
        name: "Rating changes last error",
        value: `${ratingChangesLastError.timestamp} - ${ratingChangesLastError.message}`,
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
    if (ratingAlertLastError) {
      embed.addFields({
        name: "Contest rating alerts last error",
        value: `${ratingAlertLastError.timestamp} - ${ratingAlertLastError.message}`,
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
    if (tournamentLastError) {
      embed.addFields({
        name: "Tournament last error",
        value: `${tournamentLastError.timestamp} - ${tournamentLastError.message}`,
        inline: false,
      });
    }
    if (recapLastError) {
      embed.addFields({
        name: "Tournament recaps last error",
        value: `${recapLastError.timestamp} - ${recapLastError.message}`,
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
    if (ratingAlertLastTick) {
      embed.addFields({
        name: "Contest rating alerts last tick",
        value: ratingAlertLastTick,
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
