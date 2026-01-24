import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import {
  filterContestsByKeywords,
  parseKeywordFilters,
  serializeKeywords,
} from "../utils/contestFilters.js";
import { ephemeralFlags } from "../utils/discordFlags.js";
import { formatDiscordRelativeTime, formatDiscordTimestamp } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_MINUTES = 30;
const MIN_MINUTES = 5;
const MAX_MINUTES = 24 * 60;

function formatKeywordList(keywords: string[]): string {
  return keywords.length > 0 ? keywords.join(", ") : "None";
}

function formatSubscriptionSummary(subscription: {
  id: string;
  channelId: string;
  minutesBefore: number;
  roleId: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
}): string {
  const include = formatKeywordList(subscription.includeKeywords);
  const exclude = formatKeywordList(subscription.excludeKeywords);
  const role = subscription.roleId ? `<@&${subscription.roleId}>` : "None";
  return `Channel: <#${subscription.channelId}>\nLead time: ${
    subscription.minutesBefore
  } minutes\nRole: ${role}\nInclude: ${include}\nExclude: ${exclude}\nID: \`${subscription.id}\``;
}

function resolveSubscriptionId(
  subscriptions: Array<{ id: string }>,
  inputId: string
):
  | { status: "not_found" }
  | { status: "ambiguous"; matches: string[] }
  | { status: "ok"; id: string } {
  const normalized = inputId.toLowerCase();
  const matches = subscriptions.filter((sub) => sub.id.toLowerCase().startsWith(normalized));
  if (matches.length === 0) {
    return { status: "not_found" };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches: matches.map((match) => match.id) };
  }
  return { status: "ok", id: matches[0]!.id };
}

export const contestRemindersCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestreminders")
    .setDescription("Configure Codeforces contest reminders for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a contest reminder subscription")
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
      subcommand
        .setName("set")
        .setDescription("Add a contest reminder subscription (legacy)")
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
      subcommand.setName("status").setDescription("List current reminder subscriptions")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List current reminder subscriptions")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a reminder subscription")
        .addStringOption((option) =>
          option.setName("id").setDescription("Subscription id (from list)").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Remove all contest reminders")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preview")
        .setDescription("Preview the next scheduled reminder")
        .addStringOption((option) =>
          option.setName("id").setDescription("Subscription id (from list)")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("post")
        .setDescription("Post a contest reminder immediately")
        .addBooleanOption((option) =>
          option.setName("force").setDescription("Send even if a reminder was already posted")
        )
        .addStringOption((option) =>
          option.setName("id").setDescription("Subscription id (from list)")
        )
    ),
  adminOnly: true,
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ...ephemeralFlags,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status" || subcommand === "list") {
        const subscriptions = await context.services.contestReminders.listSubscriptions(guildId);
        if (subscriptions.length === 0) {
          await interaction.reply({
            content: "No contest reminders configured for this server.",
            ...ephemeralFlags,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle("Contest reminder subscriptions")
          .setColor(0x3498db)
          .addFields(
            subscriptions.map((subscription, index) => ({
              name: `Subscription ${index + 1}`,
              value: formatSubscriptionSummary(subscription),
              inline: false,
            }))
          );

        await interaction.reply({ embeds: [embed], ...ephemeralFlags });
        return;
      }

      if (subcommand === "clear") {
        const removed = await context.services.contestReminders.clearSubscriptions(guildId);
        await interaction.reply({
          content: removed
            ? `Removed ${removed} contest reminder subscription${removed === 1 ? "" : "s"}.`
            : "No contest reminders were configured for this server.",
          ...ephemeralFlags,
        });
        return;
      }

      if (subcommand === "set" || subcommand === "add") {
        const channel = interaction.options.getChannel("channel", true);
        if (
          channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement
        ) {
          await interaction.reply({
            content: "Pick a text channel for contest reminders.",
            ...ephemeralFlags,
          });
          return;
        }
        const minutesBefore = interaction.options.getInteger("minutes_before") ?? DEFAULT_MINUTES;
        const role = interaction.options.getRole("role");
        const roleId = role?.id ?? null;
        const includeRaw = interaction.options.getString("include");
        const excludeRaw = interaction.options.getString("exclude");
        const filters = parseKeywordFilters(includeRaw, excludeRaw);

        const subscription = await context.services.contestReminders.createSubscription(
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
          content: `Contest reminders enabled in <#${channel.id}> (${minutesBefore} minutes before)${roleMention}${filterLabel}. Subscription id: \`${subscription.id}\`.`,
          ...ephemeralFlags,
        });
        return;
      }

      if (subcommand === "remove") {
        const id = interaction.options.getString("id", true);
        const subscriptions = await context.services.contestReminders.listSubscriptions(guildId);
        if (subscriptions.length === 0) {
          await interaction.reply({
            content: "No contest reminders configured for this server.",
            ...ephemeralFlags,
          });
          return;
        }
        const resolution = resolveSubscriptionId(subscriptions, id);
        if (resolution.status === "not_found") {
          await interaction.reply({
            content: "Subscription id not found. Use /contestreminders list to see current ids.",
            ...ephemeralFlags,
          });
          return;
        }
        if (resolution.status === "ambiguous") {
          await interaction.reply({
            content: `Subscription id matches multiple entries. Use the full id. Matches: ${resolution.matches.join(
              ", "
            )}`,
            ...ephemeralFlags,
          });
          return;
        }
        const removed = await context.services.contestReminders.removeSubscription(
          guildId,
          resolution.id
        );
        await interaction.reply({
          content: removed
            ? `Removed contest reminder subscription \`${resolution.id}\`.`
            : "Subscription not found.",
          ...ephemeralFlags,
        });
        return;
      }

      if (subcommand === "preview") {
        const id = interaction.options.getString("id");
        const subscriptions = await context.services.contestReminders.listSubscriptions(guildId);
        if (subscriptions.length === 0) {
          await interaction.reply({
            content: "No contest reminders configured for this server.",
            ...ephemeralFlags,
          });
          return;
        }
        let subscription = subscriptions[0]!;
        if (id) {
          const resolution = resolveSubscriptionId(subscriptions, id);
          if (resolution.status === "not_found") {
            await interaction.reply({
              content: "Subscription id not found. Use /contestreminders list to see current ids.",
              ...ephemeralFlags,
            });
            return;
          }
          if (resolution.status === "ambiguous") {
            await interaction.reply({
              content: `Subscription id matches multiple entries. Use the full id. Matches: ${resolution.matches.join(
                ", "
              )}`,
              ...ephemeralFlags,
            });
            return;
          }
          subscription = subscriptions.find((entry) => entry.id === resolution.id) ?? subscription;
        } else if (subscriptions.length > 1) {
          await interaction.reply({
            content:
              "Multiple contest reminder subscriptions are configured. Provide an id from /contestreminders list.",
            ...ephemeralFlags,
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
              ...ephemeralFlags,
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
          await interaction.reply({ content: "No upcoming contests found.", ...ephemeralFlags });
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

        embed.addFields({
          name: "Subscription id",
          value: `\`${subscription.id}\``,
          inline: false,
        });

        await interaction.reply({ embeds: [embed], ...ephemeralFlags });
        return;
      }

      if (subcommand === "post") {
        const force = interaction.options.getBoolean("force") ?? false;
        const id = interaction.options.getString("id");
        const subscriptions = await context.services.contestReminders.listSubscriptions(guildId);
        if (subscriptions.length === 0) {
          await interaction.reply({
            content: "No contest reminders configured for this server.",
            ...ephemeralFlags,
          });
          return;
        }
        let subscription = subscriptions[0]!;
        if (id) {
          const resolution = resolveSubscriptionId(subscriptions, id);
          if (resolution.status === "not_found") {
            await interaction.reply({
              content: "Subscription id not found. Use /contestreminders list to see current ids.",
              ...ephemeralFlags,
            });
            return;
          }
          if (resolution.status === "ambiguous") {
            await interaction.reply({
              content: `Subscription id matches multiple entries. Use the full id. Matches: ${resolution.matches.join(
                ", "
              )}`,
              ...ephemeralFlags,
            });
            return;
          }
          subscription = subscriptions.find((entry) => entry.id === resolution.id) ?? subscription;
        } else if (subscriptions.length > 1) {
          await interaction.reply({
            content:
              "Multiple contest reminder subscriptions are configured. Provide an id from /contestreminders list.",
            ...ephemeralFlags,
          });
          return;
        }
        await interaction.deferReply({ ...ephemeralFlags });
        const result = await context.services.contestReminders.sendManualReminder(
          subscription,
          context.client,
          force
        );

        if (result.status === "channel_missing") {
          await interaction.editReply(
            "Configured channel is missing or invalid. Use /contestreminders list + remove, then add a new subscription."
          );
          return;
        }

        if (result.status === "no_contest") {
          await interaction.editReply("No upcoming contests found with the current filters.");
          return;
        }

        if (result.status === "already_notified") {
          await interaction.editReply(
            `A reminder for ${result.contestName} was already posted at ${result.notifiedAt}. Use force to send another.`
          );
          return;
        }

        if (result.status === "sent") {
          const staleNote = result.isStale ? " (used cached contest data)" : "";
          await interaction.editReply(
            `Posted a reminder for ${result.contestName} in <#${result.channelId}>.${staleNote}`
          );
          return;
        }

        await interaction.editReply(
          "Unable to send a contest reminder right now. Try again later."
        );
        return;
      }
    } catch (error) {
      logCommandError(
        `Contest reminders failed: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.reply({ content: "Something went wrong.", ...ephemeralFlags });
    }
  },
};
