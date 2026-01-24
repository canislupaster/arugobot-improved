import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { getNextScheduledUtcMs } from "../services/practiceReminders.js";
import { logCommandError } from "../utils/commandLogging.js";
import { resolveRatingRanges, type RatingRange } from "../utils/ratingRanges.js";
import { formatDiscordRelativeTime, formatDiscordTimestamp } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;
const DEFAULT_HOUR_UTC = 9;
const DEFAULT_MINUTE_UTC = 0;
const MIN_OFFSET_MINUTES = -12 * 60;
const MAX_OFFSET_MINUTES = 14 * 60;

function formatRanges(ranges: RatingRange[]): string {
  return ranges
    .map((range) => (range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`))
    .join(", ");
}

function formatHourMinute(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absoluteMinutes = Math.abs(minutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const remainder = absoluteMinutes % 60;
  return `UTC${sign}${hours.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function normalizeMinutes(totalMinutes: number): number {
  const modulo = 24 * 60;
  return ((totalMinutes % modulo) + modulo) % modulo;
}

function toUtcTime(hour: number, minute: number, offsetMinutes: number) {
  const totalMinutes = normalizeMinutes(hour * 60 + minute - offsetMinutes);
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

function toLocalTime(hour: number, minute: number, offsetMinutes: number) {
  const totalMinutes = normalizeMinutes(hour * 60 + minute + offsetMinutes);
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

function parseUtcOffset(raw: string): { minutes: number } | { error: string } {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "Z" || trimmed === "UTC") {
    return { minutes: 0 };
  }
  const match = trimmed.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return { error: "Invalid UTC offset. Use formats like +02:00, -05:30, or Z." };
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes >= 60) {
    return { error: "Invalid UTC offset. Hours/minutes are out of range." };
  }
  const totalMinutes = sign * (hours * 60 + minutes);
  if (totalMinutes < MIN_OFFSET_MINUTES || totalMinutes > MAX_OFFSET_MINUTES) {
    return { error: "UTC offset must be between -12:00 and +14:00." };
  }
  return { minutes: totalMinutes };
}

export const practiceRemindersCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("practicereminders")
    .setDescription("Configure daily practice problem reminders")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Enable daily practice reminders")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to post practice problems in")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role to mention for practice reminders")
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
        .addIntegerOption((option) =>
          option.setName("rating").setDescription("Exact problem rating").setMinValue(0)
        )
        .addIntegerOption((option) =>
          option.setName("min_rating").setDescription("Minimum rating").setMinValue(0)
        )
        .addIntegerOption((option) =>
          option.setName("max_rating").setDescription("Maximum rating").setMinValue(0)
        )
        .addStringOption((option) =>
          option.setName("ranges").setDescription("Rating ranges (e.g. 800-1200, 1400, 1600-1800)")
        )
        .addStringOption((option) =>
          option.setName("tags").setDescription("Problem tags (e.g. dp, greedy, -math)")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show current practice reminder settings")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Disable daily practice reminders")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("preview").setDescription("Preview the next practice reminder")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("post")
        .setDescription("Post a practice problem immediately")
        .addBooleanOption((option) =>
          option.setName("force").setDescription("Send even if a reminder was already posted today")
        )
    ),
  adminOnly: true,
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status") {
        const subscription = await context.services.practiceReminders.getSubscription(guildId);
        if (!subscription) {
          await interaction.reply({
            content: "No practice reminders configured for this server.",
            ephemeral: true,
          });
          return;
        }

        const nextScheduledMs = getNextScheduledUtcMs(
          new Date(),
          subscription.hourUtc,
          subscription.minuteUtc
        );
        const localTime = toLocalTime(
          subscription.hourUtc,
          subscription.minuteUtc,
          subscription.utcOffsetMinutes
        );
        const nextScheduledSeconds = Math.floor(nextScheduledMs / 1000);
        const embed = new EmbedBuilder()
          .setTitle("Practice reminders")
          .setColor(0x2ecc71)
          .addFields(
            { name: "Channel", value: `<#${subscription.channelId}>`, inline: true },
            {
              name: "Schedule (UTC)",
              value: formatHourMinute(subscription.hourUtc, subscription.minuteUtc),
              inline: true,
            },
            ...(subscription.utcOffsetMinutes !== 0
              ? [
                  {
                    name: "Schedule (local)",
                    value: formatHourMinute(localTime.hour, localTime.minute),
                    inline: true,
                  },
                  {
                    name: "UTC offset",
                    value: formatUtcOffset(subscription.utcOffsetMinutes),
                    inline: true,
                  },
                ]
              : []),
            { name: "Ranges", value: formatRanges(subscription.ratingRanges), inline: false },
            {
              name: "Tags",
              value: subscription.tags.trim() ? subscription.tags.trim() : "None",
              inline: false,
            },
            {
              name: "Next run",
              value: `${formatDiscordTimestamp(nextScheduledSeconds)} (${formatDiscordRelativeTime(
                nextScheduledSeconds
              )})`,
              inline: false,
            }
          );

        if (subscription.lastSentAt) {
          embed.addFields({
            name: "Last sent",
            value: subscription.lastSentAt,
            inline: false,
          });
        }
        if (subscription.roleId) {
          embed.addFields({ name: "Role", value: `<@&${subscription.roleId}>`, inline: true });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (subcommand === "clear") {
        const removed = await context.services.practiceReminders.clearSubscription(guildId);
        await interaction.reply({
          content: removed
            ? "Practice reminders disabled for this server."
            : "No practice reminders were configured for this server.",
          ephemeral: true,
        });
        return;
      }

      if (subcommand === "set") {
        const channel = interaction.options.getChannel("channel", true);
        if (
          channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement
        ) {
          await interaction.reply({
            content: "Pick a text channel for practice reminders.",
            ephemeral: true,
          });
          return;
        }

        const hourInput = interaction.options.getInteger("hour_utc") ?? DEFAULT_HOUR_UTC;
        const minuteInput = interaction.options.getInteger("minute_utc") ?? DEFAULT_MINUTE_UTC;
        const utcOffsetRaw = interaction.options.getString("utc_offset")?.trim() ?? "";
        const rating = interaction.options.getInteger("rating");
        const minRatingOption = interaction.options.getInteger("min_rating");
        const maxRatingOption = interaction.options.getInteger("max_rating");
        const rangesRaw = interaction.options.getString("ranges");
        const tags = interaction.options.getString("tags")?.trim() ?? "";
        const role = interaction.options.getRole("role");
        const roleId = role?.id ?? null;
        let utcOffsetMinutes = 0;
        if (utcOffsetRaw) {
          const parsedOffset = parseUtcOffset(utcOffsetRaw);
          if ("error" in parsedOffset) {
            await interaction.reply({ content: parsedOffset.error, ephemeral: true });
            return;
          }
          utcOffsetMinutes = parsedOffset.minutes;
        }

        const rangeResult = resolveRatingRanges({
          rating,
          minRating: minRatingOption,
          maxRating: maxRatingOption,
          rangesRaw,
          defaultMin: DEFAULT_MIN_RATING,
          defaultMax: DEFAULT_MAX_RATING,
        });
        if (rangeResult.error) {
          await interaction.reply({ content: rangeResult.error, ephemeral: true });
          return;
        }

        const utcTime = toUtcTime(hourInput, minuteInput, utcOffsetMinutes);
        await context.services.practiceReminders.setSubscription(
          guildId,
          channel.id,
          utcTime.hour,
          utcTime.minute,
          utcOffsetMinutes,
          rangeResult.ranges,
          tags,
          roleId
        );

        const utcLabel = `${formatHourMinute(utcTime.hour, utcTime.minute)} UTC`;
        const localLabel = `${formatHourMinute(hourInput, minuteInput)} (${formatUtcOffset(
          utcOffsetMinutes
        )})`;
        const roleMention = roleId ? ` (mentioning <@&${roleId}>)` : "";
        await interaction.reply({
          content:
            utcOffsetMinutes === 0
              ? `Practice reminders enabled in <#${channel.id}> (daily at ${utcLabel})${roleMention}.`
              : `Practice reminders enabled in <#${channel.id}> (daily at ${localLabel}; ${utcLabel})${roleMention}.`,
          ephemeral: true,
        });
        return;
      }

      if (subcommand === "preview") {
        const preview = await context.services.practiceReminders.getPreview(guildId);
        if (!preview) {
          await interaction.reply({
            content: "No practice reminders configured for this server.",
            ephemeral: true,
          });
          return;
        }

        const nextScheduledSeconds = Math.floor(preview.nextScheduledAt / 1000);
        const localTime = toLocalTime(
          preview.subscription.hourUtc,
          preview.subscription.minuteUtc,
          preview.subscription.utcOffsetMinutes
        );
        const embed = new EmbedBuilder()
          .setTitle("Practice reminder preview")
          .setColor(0x2ecc71)
          .addFields(
            { name: "Channel", value: `<#${preview.subscription.channelId}>`, inline: true },
            {
              name: "Next run",
              value: `${formatDiscordTimestamp(nextScheduledSeconds)} (${formatDiscordRelativeTime(
                nextScheduledSeconds
              )})`,
              inline: false,
            },
            {
              name: "Schedule (UTC)",
              value: formatHourMinute(preview.subscription.hourUtc, preview.subscription.minuteUtc),
              inline: true,
            },
            ...(preview.subscription.utcOffsetMinutes !== 0
              ? [
                  {
                    name: "Schedule (local)",
                    value: formatHourMinute(localTime.hour, localTime.minute),
                    inline: true,
                  },
                  {
                    name: "UTC offset",
                    value: formatUtcOffset(preview.subscription.utcOffsetMinutes),
                    inline: true,
                  },
                ]
              : []),
            {
              name: "Ranges",
              value: formatRanges(preview.subscription.ratingRanges),
              inline: false,
            },
            {
              name: "Tags",
              value: preview.subscription.tags.trim() ? preview.subscription.tags.trim() : "None",
              inline: false,
            }
          );

        if (preview.problem) {
          embed.addFields({
            name: "Sample problem",
            value: `[${preview.problem.index}. ${preview.problem.name}](https://codeforces.com/problemset/problem/${preview.problem.contestId}/${preview.problem.index})`,
            inline: false,
          });
        } else {
          embed.addFields({
            name: "Sample problem",
            value: "No suitable problems found with the current filters.",
            inline: false,
          });
        }
        if (preview.subscription.roleId) {
          embed.addFields({
            name: "Role",
            value: `<@&${preview.subscription.roleId}>`,
            inline: true,
          });
        }

        if (preview.skippedHandles > 0 || preview.staleHandles > 0) {
          const notes = [];
          if (preview.skippedHandles > 0) {
            notes.push(`${preview.skippedHandles} handle(s) skipped`);
          }
          if (preview.staleHandles > 0) {
            notes.push(`${preview.staleHandles} handle(s) used cached solves`);
          }
          embed.setFooter({ text: notes.join(" • ") });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (subcommand === "post") {
        const force = interaction.options.getBoolean("force") ?? false;
        await interaction.deferReply({ ephemeral: true });
        const result = await context.services.practiceReminders.sendManualReminder(
          guildId,
          context.client,
          force
        );

        if (result.status === "no_subscription") {
          await interaction.editReply("No practice reminders configured for this server.");
          return;
        }

        if (result.status === "already_sent") {
          await interaction.editReply(
            `A practice reminder was already posted today (${result.lastSentAt}). Use force to send another.`
          );
          return;
        }

        if (result.status === "channel_missing") {
          await interaction.editReply(
            "Configured channel is missing or invalid. Use /practicereminders set to update it."
          );
          return;
        }

        if (result.status === "no_problem") {
          await interaction.editReply(
            "No suitable practice problems found with the current filters."
          );
          return;
        }

        if (result.status === "sent") {
          await interaction.editReply(`Posted a practice problem in <#${result.channelId}>.`);
          return;
        }

        await interaction.editReply(
          "Unable to send a practice reminder right now. Try again later."
        );
        return;
      }
    } catch (error) {
      logCommandError(
        `Practice reminders failed: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.reply({ content: "Something went wrong.", ephemeral: true });
    }
  },
};
