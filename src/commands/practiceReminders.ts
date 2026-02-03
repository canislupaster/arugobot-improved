import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { getNextScheduledUtcMs } from "../services/practiceReminders.js";
import { logCommandError } from "../utils/commandLogging.js";
import { addRatingRangeOptions, addScheduleOptions, addTagOptions } from "../utils/commandOptions.js";
import {
  describeSendableChannelStatus,
  formatCannotPostMessage,
  getSendableChannelStatus,
  resolveSendableChannelOrReply,
} from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import {
  formatRatingRangesWithDefaults,
  readRatingRangeOptions,
  resolveRatingRanges,
} from "../utils/ratingRanges.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatHourMinute,
  formatUtcOffset,
  resolveUtcOffsetMinutes,
  toLocalTime,
  toUtcTime,
} from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;
const DEFAULT_HOUR_UTC = 9;
const DEFAULT_MINUTE_UTC = 0;
const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];

function formatDaysLabel(days: number[]): string {
  const normalized = Array.from(new Set(days)).sort((a, b) => a - b);
  if (normalized.length === DEFAULT_DAYS.length) {
    return "Daily";
  }
  if (normalized.length === WEEKDAYS.length && WEEKDAYS.every((day) => normalized.includes(day))) {
    return "Weekdays";
  }
  if (normalized.length === WEEKENDS.length && WEEKENDS.every((day) => normalized.includes(day))) {
    return "Weekends";
  }
  return normalized.map((day) => DAY_LABELS[day] ?? "?").join(", ");
}

function resolveDayToken(token: string): number | null {
  switch (token) {
    case "sun":
    case "sunday":
      return 0;
    case "mon":
    case "monday":
      return 1;
    case "tue":
    case "tues":
    case "tuesday":
      return 2;
    case "wed":
    case "wednesday":
      return 3;
    case "thu":
    case "thur":
    case "thurs":
    case "thursday":
      return 4;
    case "fri":
    case "friday":
      return 5;
    case "sat":
    case "saturday":
      return 6;
    default:
      return null;
  }
}

function parseDaysInput(raw: string | null | undefined): { days: number[] } | { error: string } {
  if (!raw || !raw.trim()) {
    return { days: DEFAULT_DAYS.slice() };
  }
  const normalized = raw.trim().toLowerCase();
  if (["daily", "everyday", "all", "every"].includes(normalized)) {
    return { days: DEFAULT_DAYS.slice() };
  }
  if (["weekday", "weekdays"].includes(normalized)) {
    return { days: WEEKDAYS.slice() };
  }
  if (["weekend", "weekends"].includes(normalized)) {
    return { days: WEEKENDS.slice() };
  }

  const tokens = normalized.split(/[\s,]+/u).filter(Boolean);
  const days = new Set<number>();
  for (const token of tokens) {
    if (token.includes("-")) {
      const [startRaw, endRaw] = token.split("-", 2);
      const start = resolveDayToken(startRaw ?? "");
      const end = resolveDayToken(endRaw ?? "");
      if (start === null || end === null) {
        return { error: `Invalid day range: ${token}` };
      }
      if (start <= end) {
        for (let day = start; day <= end; day += 1) {
          days.add(day);
        }
      } else {
        for (let day = start; day <= 6; day += 1) {
          days.add(day);
        }
        for (let day = 0; day <= end; day += 1) {
          days.add(day);
        }
      }
      continue;
    }

    const resolved = resolveDayToken(token);
    if (resolved === null) {
      return { error: `Invalid day: ${token}` };
    }
    days.add(resolved);
  }

  if (days.size === 0) {
    return { error: "Select at least one day for reminders." };
  }
  return { days: Array.from(days.values()).sort((a, b) => a - b) };
}

export const practiceRemindersCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("practicereminders")
    .setDescription("Configure practice problem reminders")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      addTagOptions(
        addRatingRangeOptions(
          addScheduleOptions(
            subcommand.setName("set").setDescription("Enable practice reminders"),
            {
              channelDescription: "Channel to post practice problems in",
              roleDescription: "Role to mention for practice reminders",
            }
          )
        )
      )
        .addStringOption((option) =>
          option
            .setName("days")
            .setDescription("Days to post (e.g. mon,wed,fri, weekdays, weekends)")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show current practice reminder settings")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Disable daily practice reminders")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cleanup")
        .setDescription("Remove reminders pointing at missing channels")
        .addBooleanOption((option) =>
          option
            .setName("include_permissions")
            .setDescription("Also remove if the bot is missing channel permissions")
        )
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
          });
          return;
        }

        const channelStatus = await getSendableChannelStatus(
          context.client,
          subscription.channelId
        );
        const nextScheduledMs = getNextScheduledUtcMs(
          new Date(),
          subscription.hourUtc,
          subscription.minuteUtc,
          subscription.daysOfWeek,
          subscription.utcOffsetMinutes
        );
        const localTime = toLocalTime(
          subscription.hourUtc,
          subscription.minuteUtc,
          subscription.utcOffsetMinutes
        );
        const nextScheduledSeconds = Math.floor(nextScheduledMs / 1000);
        const embed = new EmbedBuilder()
          .setTitle("Practice reminders")
          .setColor(EMBED_COLORS.success)
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
            {
              name: "Ranges",
              value: formatRatingRangesWithDefaults(
                subscription.ratingRanges,
                DEFAULT_MIN_RATING,
                DEFAULT_MAX_RATING
              ),
              inline: false,
            },
            {
              name: "Tags",
              value: subscription.tags.trim() ? subscription.tags.trim() : "None",
              inline: false,
            },
            { name: "Days", value: formatDaysLabel(subscription.daysOfWeek), inline: true },
            {
              name: "Next run",
              value: `${formatDiscordTimestamp(nextScheduledSeconds)} (${formatDiscordRelativeTime(
                nextScheduledSeconds
              )})`,
              inline: false,
            }
          );

        if (channelStatus.status !== "ok") {
          embed.addFields({
            name: "Channel status",
            value: describeSendableChannelStatus(channelStatus),
            inline: false,
          });
        }
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

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (subcommand === "clear") {
        const removed = await context.services.practiceReminders.clearSubscription(guildId);
        await interaction.reply({
          content: removed
            ? "Practice reminders disabled for this server."
            : "No practice reminders were configured for this server.",
        });
        return;
      }

      if (subcommand === "cleanup") {
        const subscription = await context.services.practiceReminders.getSubscription(guildId);
        if (!subscription) {
          await interaction.reply({
            content: "No practice reminders were configured for this server.",
          });
          return;
        }

        const channelStatus = await getSendableChannelStatus(
          context.client,
          subscription.channelId
        );
        if (channelStatus.status === "ok") {
          await interaction.reply({
            content: "Practice reminder channel looks healthy; nothing to clean.",
          });
          return;
        }

        if (channelStatus.status === "missing_permissions") {
          const includePermissions =
            interaction.options.getBoolean("include_permissions") ?? false;
          if (!includePermissions) {
            await interaction.reply({
              content: `Practice reminders still point at <#${subscription.channelId}> (${describeSendableChannelStatus(
                channelStatus
              )}). Re-run with include_permissions:true or update the channel with /practicereminders set.`,
            });
            return;
          }
        }

        const removed = await context.services.practiceReminders.clearSubscription(guildId);
        await interaction.reply({
          content: removed
            ? `Removed practice reminders for <#${subscription.channelId}> (${describeSendableChannelStatus(
                channelStatus
              )}).`
            : "Failed to remove practice reminders. Try again later.",
        });
        return;
      }

      if (subcommand === "set") {
        const channel = await resolveSendableChannelOrReply(
          interaction,
          context.client,
          interaction.options.getChannel("channel", true),
          { invalidTypeMessage: "Pick a text channel for practice reminders." }
        );
        if (!channel) {
          return;
        }

        const hourInput = interaction.options.getInteger("hour_utc") ?? DEFAULT_HOUR_UTC;
        const minuteInput = interaction.options.getInteger("minute_utc") ?? DEFAULT_MINUTE_UTC;
        const utcOffsetRaw = interaction.options.getString("utc_offset")?.trim() ?? "";
        const { rating, minRating, maxRating, rangesRaw } = readRatingRangeOptions(interaction);
        const tags = interaction.options.getString("tags")?.trim() ?? "";
        const daysRaw = interaction.options.getString("days");
        const role = interaction.options.getRole("role");
        const roleId = role?.id ?? null;
        const utcOffsetResult = resolveUtcOffsetMinutes(utcOffsetRaw);
        if ("error" in utcOffsetResult) {
          await interaction.reply({ content: utcOffsetResult.error });
          return;
        }
        const utcOffsetMinutes = utcOffsetResult.minutes;

        const rangeResult = resolveRatingRanges({
          rating,
          minRating,
          maxRating,
          rangesRaw,
          defaultMin: DEFAULT_MIN_RATING,
          defaultMax: DEFAULT_MAX_RATING,
        });
        if (rangeResult.error) {
          await interaction.reply({ content: rangeResult.error });
          return;
        }

        const parsedDays = parseDaysInput(daysRaw);
        if ("error" in parsedDays) {
          await interaction.reply({ content: parsedDays.error });
          return;
        }

        const utcTime = toUtcTime(hourInput, minuteInput, utcOffsetMinutes);
        await context.services.practiceReminders.setSubscription(
          guildId,
          channel.id,
          utcTime.hour,
          utcTime.minute,
          utcOffsetMinutes,
          parsedDays.days,
          rangeResult.ranges,
          tags,
          roleId
        );

        const utcLabel = `${formatHourMinute(utcTime.hour, utcTime.minute)} UTC`;
        const localLabel = `${formatHourMinute(hourInput, minuteInput)} (${formatUtcOffset(
          utcOffsetMinutes
        )})`;
        const dayLabel = formatDaysLabel(parsedDays.days);
        const roleMention = roleId ? ` (mentioning <@&${roleId}>)` : "";
        await interaction.reply({
          content:
            utcOffsetMinutes === 0
              ? `Practice reminders enabled in <#${channel.id}> (${dayLabel.toLowerCase()} at ${utcLabel})${roleMention}.`
              : `Practice reminders enabled in <#${channel.id}> (${dayLabel.toLowerCase()} at ${localLabel}; ${utcLabel})${roleMention}.`,
        });
        return;
      }

      if (subcommand === "preview") {
        const preview = await context.services.practiceReminders.getPreview(guildId);
        if (!preview) {
          await interaction.reply({
            content: "No practice reminders configured for this server.",
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
          .setColor(EMBED_COLORS.success)
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
            { name: "Days", value: formatDaysLabel(preview.subscription.daysOfWeek), inline: true },
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
              value: formatRatingRangesWithDefaults(
                preview.subscription.ratingRanges,
                DEFAULT_MIN_RATING,
                DEFAULT_MAX_RATING
              ),
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

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (subcommand === "post") {
        const force = interaction.options.getBoolean("force") ?? false;
        await interaction.deferReply();
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

        if (result.status === "channel_missing_permissions") {
          await interaction.editReply(
            formatCannotPostMessage(result.channelId, {
              status: "missing_permissions",
              channelId: result.channelId,
              missingPermissions: result.missingPermissions,
            })
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
      await interaction.reply({ content: "Something went wrong." });
    }
  },
};
