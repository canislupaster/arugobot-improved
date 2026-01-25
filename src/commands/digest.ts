import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { getNextWeeklyScheduledUtcMs } from "../services/weeklyDigest.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  formatDiscordTimestamp,
  formatHourMinute,
  formatUtcOffset,
  parseUtcOffset,
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

export const digestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("digest")
    .setDescription("Configure weekly digest posts")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Enable weekly digests")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to post the digest in")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addStringOption((option) =>
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
        .addIntegerOption((option) =>
          option
            .setName("hour_utc")
            .setDescription("Hour to post (uses utc_offset if set; defaults to UTC)")
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addIntegerOption((option) =>
          option
            .setName("minute_utc")
            .setDescription("Minute to post (uses utc_offset if set; defaults to UTC)")
            .setMinValue(0)
            .setMaxValue(59)
        )
        .addStringOption((option) =>
          option
            .setName("utc_offset")
            .setDescription("UTC offset for local time (e.g. +02:00, -05:30, Z)")
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role to mention for weekly digests")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show the current digest schedule")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Disable weekly digests")
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
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guild.id;
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
        await context.services.weeklyDigest.clearSubscription(guildId);
        await interaction.reply({ content: "Weekly digests disabled." });
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
        if (result.status === "no_subscription") {
          await interaction.editReply("No weekly digests configured for this server.");
          return;
        }
        if (result.status === "channel_missing") {
          await interaction.editReply(
            `Digest channel <#${result.channelId}> is missing. Update the configuration with /digest set.`
          );
          return;
        }
        if (result.status === "already_sent") {
          await interaction.editReply(
            `A weekly digest was already sent this week (${result.lastSentAt}). Use force to send another.`
          );
          return;
        }
        if (result.status === "error") {
          await interaction.editReply(`Failed to send digest: ${result.message}`);
          return;
        }
        await interaction.editReply("Weekly digest sent.");
        return;
      }

      const channel = interaction.options.getChannel("channel", true);
      if (
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement
      ) {
        await interaction.reply({
          content: "Select a text or announcement channel.",
        });
        return;
      }

      const day = resolveDay(interaction.options.getString("day"));
      const hourInput = interaction.options.getInteger("hour_utc") ?? DEFAULT_HOUR_UTC;
      const minuteInput = interaction.options.getInteger("minute_utc") ?? DEFAULT_MINUTE_UTC;
      const utcOffsetRaw = interaction.options.getString("utc_offset")?.trim() ?? "";
      const role = interaction.options.getRole("role");

      let utcOffsetMinutes = 0;
      if (utcOffsetRaw) {
        const parsedOffset = parseUtcOffset(utcOffsetRaw);
        if ("error" in parsedOffset) {
          await interaction.reply({ content: parsedOffset.error });
          return;
        }
        utcOffsetMinutes = parsedOffset.minutes;
      }

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
