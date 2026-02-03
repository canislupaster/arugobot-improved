import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  version as discordJsVersion,
} from "discord.js";

import {
  describeSendableChannelStatus,
  getSendableChannelStatus,
  type SendableChannelStatus,
} from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { getLastError } from "../utils/logger.js";

import type { Command } from "./types.js";

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

type ChannelIssue = {
  label: string;
  channelId: string;
  status: SendableChannelStatus;
};

function formatChannelIssueLine(issue: ChannelIssue): string {
  return `${issue.label}: <#${issue.channelId}> - ${describeSendableChannelStatus(issue.status)}`;
}

async function getChannelIssues(
  context: Parameters<Command["execute"]>[1],
  guildId: string
): Promise<ChannelIssue[]> {
  const [
    contestReminders,
    ratingAlerts,
    practiceReminder,
    weeklyDigest,
    tournamentRecap,
  ] = await Promise.all([
    context.services.contestReminders.listSubscriptions(guildId),
    context.services.contestRatingAlerts.listSubscriptions(guildId),
    context.services.practiceReminders.getSubscription(guildId),
    context.services.weeklyDigest.getSubscription(guildId),
    context.services.tournamentRecaps.getSubscription(guildId),
  ]);

  const targets: Array<{ label: string; channelId: string }> = [
    ...contestReminders.map((subscription) => ({
      label: `Contest reminder (ID: ${subscription.id})`,
      channelId: subscription.channelId,
    })),
    ...ratingAlerts.map((subscription) => ({
      label: `Contest rating alert (ID: ${subscription.id})`,
      channelId: subscription.channelId,
    })),
    ...(practiceReminder
      ? [{ label: "Practice reminder", channelId: practiceReminder.channelId }]
      : []),
    ...(weeklyDigest ? [{ label: "Weekly digest", channelId: weeklyDigest.channelId }] : []),
    ...(tournamentRecap
      ? [{ label: "Tournament recaps", channelId: tournamentRecap.channelId }]
      : []),
  ];

  if (targets.length === 0) {
    return [];
  }

  const statuses = await Promise.all(
    targets.map((target) => getSendableChannelStatus(context.client, target.channelId))
  );

  return targets
    .map((target, index) => ({
      label: target.label,
      channelId: target.channelId,
      status: statuses[index]!,
    }))
    .filter((issue) => issue.status.status !== "ok");
}

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
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();
    const dbOk = await context.services.store.checkDb();
    const backupDir = context.services.databaseBackups.getBackupDir();
    const backupLastAt = context.services.databaseBackups.getLastBackupAt();
    const backupLastError = context.services.databaseBackups.getLastError();
    const lastError = getLastError();
    const cfLastError = context.services.codeforces.getLastError();
    const cfLastSuccessAt = context.services.codeforces.getLastSuccessAt();
    const lastRefreshAt = context.services.problems.getLastRefreshAt();
    const problemLastError = context.services.problems.getLastError();
    const contestRefreshAt = context.services.contests.getLastRefreshAt();
    const contestLastError = context.services.contests.getLastError();
    const contestRatingChangesLastError = context.services.contestRatingChanges.getLastError();
    const ratingChangesLastError = context.services.ratingChanges.getLastError();
    const tokenSnapshot = context.services.tokenUsage.getSnapshot();
    const tokenLastError = context.services.tokenUsage.getLastError();
    const webStatus = context.webStatus;
    const webPort =
      webStatus.actualPort ?? (webStatus.requestedPort === 0 ? null : webStatus.requestedPort);
    const webLabel =
      webStatus.status === "listening"
        ? `Listening on ${webStatus.host}:${webPort ?? "unknown"}`
        : webStatus.status === "starting"
          ? "Starting"
          : "Disabled";
    const [
      reminderCount,
      ratingAlertCount,
      practiceReminderCount,
      digestCount,
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
      context.services.weeklyDigest.getSubscriptionCount(),
      context.services.challenges.getActiveCount(),
      context.services.tournaments.getActiveCount(),
      context.services.tournamentRecaps.getSubscriptionCount(),
      context.services.metrics.getCommandCount(),
      context.services.metrics.getUniqueCommandCount(),
      context.services.metrics.getLastCommandAt(),
      context.services.metrics.getCommandUsageSummary(5),
    ]);
    const channelIssues = await getChannelIssues(context, interaction.guild.id);

    const reminderLastTick = context.services.contestReminders.getLastTickAt();
    const reminderLastError = context.services.contestReminders.getLastError();
    const ratingAlertLastTick = context.services.contestRatingAlerts.getLastTickAt();
    const ratingAlertLastError = context.services.contestRatingAlerts.getLastError();
    const practiceReminderLastTick = context.services.practiceReminders.getLastTickAt();
    const practiceReminderLastError = context.services.practiceReminders.getLastError();
    const digestLastTick = context.services.weeklyDigest.getLastTickAt();
    const digestLastError = context.services.weeklyDigest.getLastError();
    const challengeLastTick = context.services.challenges.getLastTickAt();
    const challengeLastError = context.services.challenges.getLastError();
    const tournamentLastError = context.services.tournaments.getLastError();
    const recapLastError = context.services.tournamentRecaps.getLastError();
    const cacheAgeSeconds =
      lastRefreshAt > 0 ? Math.floor((Date.now() - lastRefreshAt) / 1000) : null;
    const contestCacheAgeSeconds =
      contestRefreshAt > 0 ? Math.floor((Date.now() - contestRefreshAt) / 1000) : null;

    const formatError = (entry: { timestamp: string; message: string }) =>
      `${entry.timestamp} - ${entry.message}`;

    const embed = new EmbedBuilder()
      .setTitle("ArugoBot Health")
      .setColor(EMBED_COLORS.info)
      .addFields([
        { name: "Uptime", value: `${uptimeSeconds}s`, inline: true },
        { name: "Memory", value: `${Math.round(memory.rss / 1024 / 1024)} MB`, inline: true },
        { name: "DB", value: dbOk ? "OK" : "Failed", inline: true },
        { name: "Web dashboard", value: webLabel, inline: true },
        {
          name: "DB backups",
          value: backupDir ? (backupLastAt ?? "Pending") : "Disabled",
          inline: true,
        },
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
        { name: "Weekly digests", value: String(digestCount), inline: true },
        { name: "Active challenges", value: String(activeChallenges), inline: true },
        { name: "Active tournaments", value: String(activeTournaments), inline: true },
        { name: "Tournament recaps", value: String(recapCount), inline: true },
        { name: "Commands handled", value: String(commandCount), inline: true },
        { name: "Unique commands", value: String(uniqueCommandCount), inline: true },
        { name: "Node", value: process.version, inline: true },
        { name: "discord.js", value: discordJsVersion, inline: true },
        { name: "Bot version", value: process.env.npm_package_version ?? "unknown", inline: true },
      ]);

    if (tokenSnapshot) {
      const tokenLines = [
        `Total: ${formatNumber(tokenSnapshot.totalTokens)}`,
        `Energy: ${formatNumber(tokenSnapshot.impact.energyKwh)} kWh`,
        `Water: ${formatNumber(tokenSnapshot.impact.waterLiters)} L`,
        `Carbon: ${formatNumber(tokenSnapshot.impact.carbonKg)} kg CO2e`,
        tokenSnapshot.lastUpdatedAt ? `Updated: ${tokenSnapshot.lastUpdatedAt}` : null,
      ].filter(Boolean);
      embed.addFields({
        name: "Token estimates",
        value: tokenLines.join("\n"),
        inline: false,
      });
    }

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

    if (channelIssues.length > 0) {
      const previewLimit = 6;
      const lines = channelIssues.slice(0, previewLimit).map(formatChannelIssueLine);
      if (channelIssues.length > previewLimit) {
        lines.push(`...and ${channelIssues.length - previewLimit} more`);
      }
      embed.addFields({
        name: "Channel issues",
        value: lines.join("\n"),
        inline: false,
      });
    }

    const errorFields = [
      { name: "Last error", value: lastError },
      { name: "Web server last error", value: webStatus.lastError },
      { name: "Problem cache last error", value: problemLastError },
      { name: "Codeforces last error", value: cfLastError },
      { name: "Contest cache last error", value: contestLastError },
      { name: "Contest rating changes last error", value: contestRatingChangesLastError },
      { name: "Rating changes last error", value: ratingChangesLastError },
      { name: "Contest reminders last error", value: reminderLastError },
      { name: "Contest rating alerts last error", value: ratingAlertLastError },
      { name: "Practice reminders last error", value: practiceReminderLastError },
      { name: "Weekly digest last error", value: digestLastError },
      { name: "Challenge loop last error", value: challengeLastError },
      { name: "Tournament last error", value: tournamentLastError },
      { name: "Tournament recaps last error", value: recapLastError },
      { name: "DB backups last error", value: backupLastError },
      { name: "Token usage last error", value: tokenLastError },
    ];

    for (const entry of errorFields) {
      if (!entry.value) {
        continue;
      }
      embed.addFields({
        name: entry.name,
        value: formatError(entry.value),
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

    const tickFields = [
      { name: "Challenge loop last tick", value: challengeLastTick },
      { name: "Contest reminders last tick", value: reminderLastTick },
      { name: "Contest rating alerts last tick", value: ratingAlertLastTick },
      { name: "Practice reminders last tick", value: practiceReminderLastTick },
      { name: "Weekly digests last tick", value: digestLastTick },
    ];

    for (const entry of tickFields) {
      if (!entry.value) {
        continue;
      }
      embed.addFields({
        name: entry.name,
        value: entry.value,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
