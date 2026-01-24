import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import {
  filterContestsByKeywords,
  parseKeywordFilters,
  serializeKeywords,
} from "../utils/contestFilters.js";
import { formatDiscordRelativeTime, formatDiscordTimestamp } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_MINUTES = 30;
const MIN_MINUTES = 5;
const MAX_MINUTES = 24 * 60;

function formatKeywordList(keywords: string[]): string {
  return keywords.length > 0 ? keywords.join(", ") : "None";
}

export const contestRemindersCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestreminders")
    .setDescription("Configure Codeforces contest reminders for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Enable contest reminders")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to post reminders in")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role to mention for reminders")
        )
        .addIntegerOption((option) =>
          option
            .setName("minutes_before")
            .setDescription(`Minutes before start to notify (${MIN_MINUTES}-${MAX_MINUTES})`)
            .setMinValue(MIN_MINUTES)
            .setMaxValue(MAX_MINUTES)
        )
        .addStringOption((option) =>
          option
            .setName("include")
            .setDescription("Only remind for contests matching keywords (comma-separated)")
        )
        .addStringOption((option) =>
          option
            .setName("exclude")
            .setDescription("Skip contests matching keywords (comma-separated)")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show current reminder settings")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Disable contest reminders")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("preview").setDescription("Preview the next scheduled reminder")
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
        const subscription = await context.services.contestReminders.getSubscription(guildId);
        if (!subscription) {
          await interaction.reply({
            content: "No contest reminders configured for this server.",
            ephemeral: true,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle("Contest reminders")
          .setColor(0x3498db)
          .addFields(
            { name: "Channel", value: `<#${subscription.channelId}>`, inline: true },
            {
              name: "Lead time",
              value: `${subscription.minutesBefore} minutes`,
              inline: true,
            },
            {
              name: "Include keywords",
              value: formatKeywordList(subscription.includeKeywords),
              inline: false,
            },
            {
              name: "Exclude keywords",
              value: formatKeywordList(subscription.excludeKeywords),
              inline: false,
            },
            ...(subscription.roleId
              ? [{ name: "Role", value: `<@&${subscription.roleId}>`, inline: true }]
              : [])
          );

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (subcommand === "clear") {
        const removed = await context.services.contestReminders.clearSubscription(guildId);
        await interaction.reply({
          content: removed
            ? "Contest reminders disabled for this server."
            : "No contest reminders were configured for this server.",
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
            content: "Pick a text channel for contest reminders.",
            ephemeral: true,
          });
          return;
        }
        const minutesBefore = interaction.options.getInteger("minutes_before") ?? DEFAULT_MINUTES;
        const role = interaction.options.getRole("role");
        const roleId = role?.id ?? null;
        const includeRaw = interaction.options.getString("include");
        const excludeRaw = interaction.options.getString("exclude");
        const filters = parseKeywordFilters(includeRaw, excludeRaw);

        await context.services.contestReminders.setSubscription(
          guildId,
          channel.id,
          minutesBefore,
          roleId,
          filters.includeKeywords,
          filters.excludeKeywords
        );
        const filterLabel =
          filters.includeKeywords.length > 0 || filters.excludeKeywords.length > 0
            ? ` (include: ${serializeKeywords(filters.includeKeywords) || "none"}, exclude: ${
                serializeKeywords(filters.excludeKeywords) || "none"
              })`
            : "";
        const roleMention = roleId ? ` (mentioning <@&${roleId}>)` : "";
        await interaction.reply({
          content: `Contest reminders enabled in <#${channel.id}> (${minutesBefore} minutes before)${roleMention}${filterLabel}.`,
          ephemeral: true,
        });
        return;
      }

      if (subcommand === "preview") {
        const subscription = await context.services.contestReminders.getSubscription(guildId);
        if (!subscription) {
          await interaction.reply({
            content: "No contest reminders configured for this server.",
            ephemeral: true,
          });
          return;
        }

        let stale = false;
        try {
          await context.services.contests.refresh();
        } catch {
          if (context.services.contests.getLastRefreshAt() > 0) {
            stale = true;
          } else {
            await interaction.reply({
              content: "Unable to reach Codeforces right now. Try again in a few minutes.",
              ephemeral: true,
            });
            return;
          }
        }

        const upcoming = context.services.contests.getUpcoming(10);
        const filtered = filterContestsByKeywords(upcoming, {
          includeKeywords: subscription.includeKeywords,
          excludeKeywords: subscription.excludeKeywords,
        });
        if (filtered.length === 0) {
          await interaction.reply({ content: "No upcoming contests found.", ephemeral: true });
          return;
        }

        const contest = filtered[0]!;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const reminderTime = contest.startTimeSeconds - subscription.minutesBefore * 60;
        const reminderLabel =
          reminderTime <= nowSeconds
            ? "Reminder window already open"
            : `${formatDiscordTimestamp(reminderTime)} (${formatDiscordRelativeTime(reminderTime)})`;

        const embed = new EmbedBuilder()
          .setTitle("Contest reminder preview")
          .setColor(0x3498db)
          .addFields(
            { name: "Contest", value: contest.name, inline: false },
            { name: "Channel", value: `<#${subscription.channelId}>`, inline: true },
            {
              name: "Lead time",
              value: `${subscription.minutesBefore} minutes`,
              inline: true,
            },
            {
              name: "Contest start",
              value: `${formatDiscordTimestamp(contest.startTimeSeconds)} (${formatDiscordRelativeTime(
                contest.startTimeSeconds
              )})`,
              inline: false,
            },
            { name: "Reminder time", value: reminderLabel, inline: false }
          );

        if (subscription.roleId) {
          embed.addFields({ name: "Role", value: `<@&${subscription.roleId}>`, inline: true });
        }
        if (subscription.includeKeywords.length > 0 || subscription.excludeKeywords.length > 0) {
          embed.addFields(
            {
              name: "Include keywords",
              value: formatKeywordList(subscription.includeKeywords),
              inline: false,
            },
            {
              name: "Exclude keywords",
              value: formatKeywordList(subscription.excludeKeywords),
              inline: false,
            }
          );
        }

        if (stale) {
          embed.setFooter({ text: "Showing cached contest data due to a temporary error." });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
    } catch (error) {
      logCommandError(
        `Contest reminders failed: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.reply({ content: "Something went wrong.", ephemeral: true });
    }
  },
};
