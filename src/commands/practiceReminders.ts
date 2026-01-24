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

function formatRanges(ranges: RatingRange[]): string {
  return ranges
    .map((range) => (range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`))
    .join(", ");
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
        .addIntegerOption((option) =>
          option
            .setName("hour_utc")
            .setDescription("Hour in UTC to post (0-23)")
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addIntegerOption((option) =>
          option
            .setName("minute_utc")
            .setDescription("Minute in UTC to post (0-59)")
            .setMinValue(0)
            .setMaxValue(59)
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
        const nextScheduledSeconds = Math.floor(nextScheduledMs / 1000);
        const embed = new EmbedBuilder()
          .setTitle("Practice reminders")
          .setColor(0x2ecc71)
          .addFields(
            { name: "Channel", value: `<#${subscription.channelId}>`, inline: true },
            {
              name: "Schedule (UTC)",
              value: `${subscription.hourUtc.toString().padStart(2, "0")}:${subscription.minuteUtc
                .toString()
                .padStart(2, "0")}`,
              inline: true,
            },
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

        const hourUtc = interaction.options.getInteger("hour_utc") ?? DEFAULT_HOUR_UTC;
        const minuteUtc = interaction.options.getInteger("minute_utc") ?? DEFAULT_MINUTE_UTC;
        const rating = interaction.options.getInteger("rating");
        const minRatingOption = interaction.options.getInteger("min_rating");
        const maxRatingOption = interaction.options.getInteger("max_rating");
        const rangesRaw = interaction.options.getString("ranges");
        const tags = interaction.options.getString("tags")?.trim() ?? "";

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

        await context.services.practiceReminders.setSubscription(
          guildId,
          channel.id,
          hourUtc,
          minuteUtc,
          rangeResult.ranges,
          tags
        );

        const timeLabel = `${hourUtc.toString().padStart(2, "0")}:${minuteUtc
          .toString()
          .padStart(2, "0")} UTC`;
        await interaction.reply({
          content: `Practice reminders enabled in <#${channel.id}> (daily at ${timeLabel}).`,
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
