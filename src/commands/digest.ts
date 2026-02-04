import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import {
  getNextWeeklyScheduledUtcMs,
  type ManualWeeklyDigestResult,
} from "../services/weeklyDigest.js";
import { cleanupSingleChannelSubscription } from "../utils/channelCleanup.js";
import { logCommandError } from "../utils/commandLogging.js";
import { addCleanupIncludePermissionsOption, addScheduleOptions } from "../utils/commandOptions.js";
import {
  describeSendableChannelStatus,
  formatCannotPostPermissionsMessage,
  resolveSendableChannelOrReply,
} from "../utils/discordChannels.js";
import { requireGuildIdEphemeral } from "../utils/interaction.js";
import {
  formatDiscordTimestamp,
  formatHourMinute,
  formatUtcOffset,
  resolveUtcOffsetMinutes,
  toLocalTime,
  toUtcTime,
} from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_HOUR_UTC = 9;
const DEFAULT_MINUTE_UTC = 0;
const DEFAULT_DAY = "mon";

const DAY_LABELS: Record<string, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

const DAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function resolveDay(day: string | null): string {
  if (!day) {
    return DEFAULT_DAY;
  }
  if (Object.hasOwn(DAY_INDEX, day)) {
    return day;
  }
  return DEFAULT_DAY;
}

function formatDayLabel(day: string): string {
  return DAY_LABELS[day] ?? "Monday";
}

function formatScheduleLabel(
  day: string,
  hourUtc: number,
  minuteUtc: number,
  utcOffsetMinutes: number
): string {
  const utcLabel = `${formatHourMinute(hourUtc, minuteUtc)} UTC`;
  if (utcOffsetMinutes === 0) {
    return `${formatDayLabel(day)} at ${utcLabel}`;
  }
  const local = toLocalTime(hourUtc, minuteUtc, utcOffsetMinutes);
  return `${formatDayLabel(day)} at ${formatHourMinute(local.hour, local.minute)} ${formatUtcOffset(
    utcOffsetMinutes
  )} (${utcLabel})`;
}

function getManualDigestReply(result: ManualWeeklyDigestResult): string | null {
  switch (result.status) {
    case "no_subscription":
      return "No weekly digests configured for this server.";
    case "channel_missing_permissions":
      return formatCannotPostPermissionsMessage(result.channelId, result.missingPermissions);
    case "channel_missing":
      return `Digest channel <#${result.channelId}> is missing. Update the configuration with /digest set.`;
    case "already_sent":
      return `A weekly digest was already sent this week (${result.lastSentAt}). Use force to send another.`;
    case "error":
      return `Failed to send digest: ${result.message}`;
    case "sent":
      return null;
  }
}

export const digestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("digest")
    .setDescription("Configure weekly digest posts")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      addScheduleOptions(subcommand.setName("set").setDescription("Enable weekly digests"), {
        channelDescription: "Channel to post the digest in",
        roleDescription: "Role to mention for weekly digests",
      }).addStringOption((option) =>
        option
          .setName("day")
          .setDescription("Day of the week to post")
          .addChoices(
            { name: "Sunday", value: "sun" },
            { name: "Monday", value: "mon" },
            { name: "Tuesday", value: "tue" },
            { name: "Wednesday", value: "wed" },
            { name: "Thursday", value: "thu" },
            { name: "Friday", value: "fri" },
            { name: "Saturday", value: "sat" }
          )
      )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show the current digest schedule")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Disable weekly digests")
    )
    .addSubcommand((subcommand) =>
      addCleanupIncludePermissionsOption(
        subcommand
          .setName("cleanup")
          .setDescription("Remove digests pointing at missing channels")
      )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preview")
        .setDescription("Show a preview of the weekly digest for this server")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("post")
        .setDescription("Send the digest immediately")
        .addBooleanOption((option) =>
          option.setName("force").setDescription("Send even if a digest was already sent this week")
        )
    ),
  adminOnly: true,
  async execute(interaction, context) {
    const guildId = await requireGuildIdEphemeral(
      interaction,
      "This command can only be used in a server."
    );
    if (!guildId) {
      return;
    }
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status") {
        const subscription = await context.services.weeklyDigest.getSubscription(guildId);
        if (!subscription) {
          await interaction.reply({ content: "No weekly digests configured for this server." });
          return;
        }
        const dayKey = Object.entries(DAY_INDEX).find(
          ([, value]) => value === subscription.dayOfWeek
        )?.[0];
        const scheduleLabel = formatScheduleLabel(
          dayKey ?? DEFAULT_DAY,
          subscription.hourUtc,
          subscription.minuteUtc,
          subscription.utcOffsetMinutes
        );
        const nextValue = getNextWeeklyScheduledUtcMs(
          new Date(),
          subscription.dayOfWeek,
          subscription.hourUtc,
          subscription.minuteUtc,
          subscription.utcOffsetMinutes
        );
        const nextLabel = nextValue
          ? formatDiscordTimestamp(Math.floor(nextValue / 1000))
          : "Unknown";
        await interaction.reply({
          content: `Weekly digests are enabled in <#${subscription.channelId}> (${scheduleLabel}). Next post: ${nextLabel}.`,
        });
        return;
      }

      if (subcommand === "clear") {
        const removed = await context.services.weeklyDigest.clearSubscription(guildId);
        await interaction.reply({
          content: removed
            ? "Weekly digests disabled."
            : "No weekly digests were configured for this server.",
        });
        return;
      }

      if (subcommand === "cleanup") {
        const subscription = await context.services.weeklyDigest.getSubscription(guildId);
        if (!subscription) {
          await interaction.reply({ content: "No weekly digests configured for this server." });
          return;
        }

        const includePermissions = interaction.options.getBoolean("include_permissions") ?? false;
        const replyMessage = await cleanupSingleChannelSubscription({
          client: context.client,
          channelId: subscription.channelId,
          includePermissions,
          healthyMessage: "Weekly digest channel looks healthy; nothing to clean.",
          missingPermissionsMessage: (status) =>
            `Weekly digest still points at <#${subscription.channelId}> (${describeSendableChannelStatus(
              status
            )}). Re-run with include_permissions:true or update the channel with /digest set.`,
          remove: () => context.services.weeklyDigest.clearSubscription(guildId),
          removedMessage: (status) =>
            `Removed weekly digest for <#${subscription.channelId}> (${describeSendableChannelStatus(
              status
            )}).`,
          failedMessage: "Failed to remove weekly digest. Try again later.",
        });
        await interaction.reply({ content: replyMessage });
        return;
      }

      if (subcommand === "preview") {
        await interaction.deferReply();
        const preview = await context.services.weeklyDigest.getPreview(guildId);
        if (!preview) {
          await interaction.editReply("No weekly digests configured for this server.");
          return;
        }
        await interaction.editReply({
          content: `Next scheduled post: ${formatDiscordTimestamp(
            Math.floor(preview.nextScheduledAt / 1000)
          )}`,
          embeds: [preview.embed],
        });
        return;
      }

      if (subcommand === "post") {
        await interaction.deferReply();
        const force = interaction.options.getBoolean("force") ?? false;
        const result = await context.services.weeklyDigest.sendManualDigest(
          guildId,
          context.client,
          force
        );
        const reply = getManualDigestReply(result);
        await interaction.editReply(reply ?? "Weekly digest sent.");
        return;
      }

      const channel = await resolveSendableChannelOrReply(
        interaction,
        context.client,
        interaction.options.getChannel("channel", true),
        { invalidTypeMessage: "Select a text or announcement channel." }
      );
      if (!channel) {
        return;
      }

      const day = resolveDay(interaction.options.getString("day"));
      const hourInput = interaction.options.getInteger("hour_utc") ?? DEFAULT_HOUR_UTC;
      const minuteInput = interaction.options.getInteger("minute_utc") ?? DEFAULT_MINUTE_UTC;
      const utcOffsetRaw = interaction.options.getString("utc_offset")?.trim() ?? "";
      const role = interaction.options.getRole("role");

      const utcOffsetResult = resolveUtcOffsetMinutes(utcOffsetRaw);
      if ("error" in utcOffsetResult) {
        await interaction.reply({ content: utcOffsetResult.error });
        return;
      }
      const utcOffsetMinutes = utcOffsetResult.minutes;

      const utcTime = toUtcTime(hourInput, minuteInput, utcOffsetMinutes);
      const dayIndex = DAY_INDEX[day] ?? DAY_INDEX[DEFAULT_DAY];
      await context.services.weeklyDigest.setSubscription(
        guildId,
        channel.id,
        dayIndex,
        utcTime.hour,
        utcTime.minute,
        utcOffsetMinutes,
        role?.id ?? null
      );
      const scheduleLabel = formatScheduleLabel(
        day,
        utcTime.hour,
        utcTime.minute,
        utcOffsetMinutes
      );
      const roleMention = role ? ` <@&${role.id}>` : "";
      await interaction.reply({
        content: `Weekly digests enabled in <#${channel.id}> (${scheduleLabel})${roleMention}.`,
        allowedMentions: role ? { roles: [role.id] } : { parse: [] },
      });
    } catch (error) {
      logCommandError("Digest command failed.", interaction, context.correlationId, {
        error: error instanceof Error ? error.message : String(error),
      });
      await interaction.reply({ content: "Failed to update digest settings." });
    }
  },
};
