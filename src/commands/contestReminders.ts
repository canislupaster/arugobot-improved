import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

import type { ContestReminder } from "../services/contestReminders.js";
import type { Contest, ContestScopeFilter } from "../services/contests.js";
import { runChannelCleanupSummary } from "../utils/channelCleanup.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  addCleanupSubcommand,
  addPostSubcommand,
  addPreviewSubcommand,
} from "../utils/commandOptions.js";
import {
  filterContestsByKeywords,
  getContestReminderPreset,
  listContestReminderPresets,
  parseKeywordFilters,
  serializeKeywords,
  type ContestReminderPreset,
} from "../utils/contestFilters.js";
import {
  addContestScopeOption,
  formatContestScopeLabel,
  parseContestScope,
  refreshContestData,
} from "../utils/contestScope.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import {
  describeSendableChannelStatus,
  formatCannotPostPermissionsMessage,
  resolveSendableChannelOrReply,
  type SendableChannelStatus,
} from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { requireGuild, resolveBooleanOption } from "../utils/interaction.js";
import {
  appendSubscriptionIdField,
  resolveSubscriptionSelectionFromInteraction,
} from "../utils/subscriptionSelection.js";
import {
  buildSubscriptionListEmbed,
  resolveSubscriptionEntriesFromService,
} from "../utils/subscriptionStatus.js";
import { formatDiscordRelativeTime, formatDiscordTimestamp } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_MINUTES = 30;
const MIN_MINUTES = 5;
const MAX_MINUTES = 24 * 60;
const DEFAULT_SCOPE: ContestScopeFilter = "official";

function formatKeywordList(keywords: string[]): string {
  return keywords.length > 0 ? keywords.join(", ") : "None";
}

function formatFilterLabel(includeKeywords: string[], excludeKeywords: string[]): string {
  if (includeKeywords.length === 0 && excludeKeywords.length === 0) {
    return "";
  }
  return ` (include: ${serializeKeywords(includeKeywords) || "none"}, exclude: ${
    serializeKeywords(excludeKeywords) || "none"
  })`;
}

function formatRoleMention(roleId: string | null): string {
  return roleId ? ` (mentioning <@&${roleId}>)` : "";
}

function buildSubscriptionResponse(input: {
  intro: string;
  channelId: string;
  minutesBefore: number;
  scope: ContestScopeFilter;
  roleId: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  subscriptionId: string;
}): string {
  return `${input.intro} in <#${input.channelId}> (${input.minutesBefore} minutes before, ${formatContestScopeLabel(
    input.scope
  )})${formatRoleMention(input.roleId)}${formatFilterLabel(
    input.includeKeywords,
    input.excludeKeywords
  )}. Subscription id: \`${input.subscriptionId}\`.`;
}

function formatChannelStatus(status?: SendableChannelStatus | null): string | null {
  if (!status || status.status === "ok") {
    return null;
  }
  return `Channel status: ${describeSendableChannelStatus(status)}`;
}

function formatSubscriptionSummary(
  subscription: ContestReminder,
  channelStatus?: SendableChannelStatus | null,
  lastNotifiedAt?: string | null
): string {
  const include = formatKeywordList(subscription.includeKeywords);
  const exclude = formatKeywordList(subscription.excludeKeywords);
  const role = subscription.roleId ? `<@&${subscription.roleId}>` : "None";
  const statusLine = formatChannelStatus(channelStatus);
  const lastSentLine = `Last sent: ${lastNotifiedAt ?? "Never"}`;
  const lines = [
    `Channel: <#${subscription.channelId}>`,
    ...(statusLine ? [statusLine] : []),
    lastSentLine,
    `Lead time: ${subscription.minutesBefore} minutes`,
    `Scope: ${formatContestScopeLabel(subscription.scope)}`,
    `Role: ${role}`,
    `Include: ${include}`,
    `Exclude: ${exclude}`,
    `ID: \`${subscription.id}\``,
  ];
  return lines.join("\n");
}

type NextReminderInfo = {
  contest: Contest;
  reminderTimeSeconds: number;
  reminderWindowOpen: boolean;
};

type ScopeRefreshState = {
  stale: boolean;
  scopeErrors: Map<ContestScopeFilter, string>;
};

async function refreshContestScopes(
  contests: {
    refresh: (force: boolean, scope: "official" | "gym") => Promise<void>;
    getLastRefreshAt: (scope: ContestScopeFilter) => number;
  },
  subscriptions: ContestReminder[]
): Promise<ScopeRefreshState> {
  const scopes = new Set(subscriptions.map((subscription) => subscription.scope));
  const scopeErrors = new Map<ContestScopeFilter, string>();
  let stale = false;

  for (const scope of scopes) {
    const result = await refreshContestData(contests, scope);
    if ("error" in result) {
      scopeErrors.set(scope, result.error);
      continue;
    }
    if (result.stale) {
      stale = true;
    }
  }

  return { stale, scopeErrors };
}

function getNextReminderInfo(
  subscription: ContestReminder,
  upcomingByScope: Map<ContestScopeFilter, Contest[]>,
  nowSeconds: number
): NextReminderInfo | null {
  const contests = upcomingByScope.get(subscription.scope) ?? [];
  const filtered = filterContestsByKeywords(contests, {
    includeKeywords: subscription.includeKeywords,
    excludeKeywords: subscription.excludeKeywords,
  });
  if (filtered.length === 0) {
    return null;
  }
  const contest = filtered[0]!;
  const reminderTimeSeconds = contest.startTimeSeconds - subscription.minutesBefore * 60;
  return {
    contest,
    reminderTimeSeconds,
    reminderWindowOpen: reminderTimeSeconds <= nowSeconds,
  };
}

function formatNextReminderLine(
  subscription: ContestReminder,
  info: NextReminderInfo | null,
  scopeErrors: Map<ContestScopeFilter, string>
): string {
  if (!info) {
    return scopeErrors.has(subscription.scope) ? "Next: Contest data unavailable" : "Next: None";
  }
  const contestLabel = `[${info.contest.name}](${buildContestUrl(info.contest)})`;
  const reminderLabel = info.reminderWindowOpen
    ? "Reminder window open"
    : `${formatDiscordTimestamp(info.reminderTimeSeconds)} (${formatDiscordRelativeTime(
        info.reminderTimeSeconds
      )})`;
  return `Next: ${contestLabel} (${formatDiscordRelativeTime(info.contest.startTimeSeconds)})\nReminder: ${reminderLabel}`;
}

function addReminderChannelOptions(
  subcommand: SlashCommandSubcommandBuilder
): SlashCommandSubcommandBuilder {
  return subcommand
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
    );
}

function addReminderOptions(
  subcommand: SlashCommandSubcommandBuilder
): SlashCommandSubcommandBuilder {
  return addReminderChannelOptions(subcommand)
    .addStringOption((option) =>
      option
        .setName("include")
        .setDescription("Only remind for contests matching keywords (comma-separated)")
    )
    .addStringOption((option) =>
      option.setName("exclude").setDescription("Skip contests matching keywords (comma-separated)")
    )
    .addStringOption((option) => addContestScopeOption(option, "Which contests to include"));
}

const NO_SUBSCRIPTIONS_MESSAGE = "No contest reminders configured for this server.";
const NO_ISSUES_MESSAGE = "All contest reminder subscriptions are healthy.";
const MULTIPLE_SUBSCRIPTIONS_MESSAGE =
  "Multiple contest reminder subscriptions are configured. Provide an id from /contestreminders list.";
const selectionMessages = {
  none: NO_SUBSCRIPTIONS_MESSAGE,
  needsId: MULTIPLE_SUBSCRIPTIONS_MESSAGE,
  notFound: "Subscription id not found. Use /contestreminders list to see current ids.",
  ambiguous: (matches: string[]) =>
    `Subscription id matches multiple entries. Use the full id. Matches: ${matches.join(", ")}`,
};

export const contestRemindersCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestreminders")
    .setDescription("Configure Codeforces contest reminders for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      addReminderOptions(
        subcommand.setName("add").setDescription("Add a contest reminder subscription")
      )
    )
    .addSubcommand((subcommand) =>
      addReminderOptions(
        subcommand.setName("set").setDescription("Add a contest reminder subscription (legacy)")
      )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("List current reminder subscriptions")
        .addBooleanOption((option) =>
          option
            .setName("only_issues")
            .setDescription("Only show reminders with missing channels or permissions")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List current reminder subscriptions")
        .addBooleanOption((option) =>
          option
            .setName("only_issues")
            .setDescription("Only show reminders with missing channels or permissions")
        )
    )
    .addSubcommand((subcommand) => {
      const withPreset = subcommand
        .setName("preset")
        .setDescription("Add a reminder preset (Div 1, Div 2, Div 3, Div 4, Educational)")
        .addStringOption((option) => {
          const choice = option
            .setName("preset")
            .setDescription("Reminder preset")
            .setRequired(true);
          for (const preset of listContestReminderPresets()) {
            choice.addChoices({ name: preset.name, value: preset.value });
          }
          return choice;
        });
      return addReminderChannelOptions(withPreset).addStringOption((option) =>
        addContestScopeOption(option, "Which contests to include")
      );
    })
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
      addCleanupSubcommand(
        subcommand,
        "Remove contest reminders targeting deleted channels",
        "Also remove subscriptions where the bot lacks permissions"
      )
    )
    .addSubcommand((subcommand) =>
      addPreviewSubcommand(subcommand, {
        description: "Preview the next scheduled reminder",
        idDescription: "Subscription id (from list)",
      })
    )
    .addSubcommand((subcommand) =>
      addPostSubcommand(subcommand, {
        description: "Post a contest reminder immediately",
        forceDescription: "Send even if a reminder was already posted",
        idDescription: "Subscription id (from list)",
      })
    ),
  adminOnly: true,
  async execute(interaction, context) {
    const guild = await requireGuild(interaction, {
      content: "This command can only be used in a server.",
    });
    if (!guild) {
      return;
    }

    const guildId = guild.id;
    const subcommand = interaction.options.getSubcommand();
    const resolveSubscription = async () => {
      return resolveSubscriptionSelectionFromInteraction(
        interaction,
        () => context.services.contestReminders.listSubscriptions(guildId),
        selectionMessages
      );
    };

    try {
      if (subcommand === "status" || subcommand === "list") {
        const onlyIssues = resolveBooleanOption(interaction, "only_issues");
        const entryResult = await resolveSubscriptionEntriesFromService(
          interaction,
          context.client,
          () => context.services.contestReminders.listSubscriptions(guildId),
          (ids) => context.services.contestReminders.getLastNotificationMap(ids),
          onlyIssues,
          { noSubscriptions: NO_SUBSCRIPTIONS_MESSAGE, noIssues: NO_ISSUES_MESSAGE }
        );
        if (entryResult.status === "replied") {
          return;
        }
        const refreshState = await refreshContestScopes(
          context.services.contests,
          entryResult.subscriptions
        );
        const upcomingByScope = new Map<ContestScopeFilter, Contest[]>();
        const scopeSet = new Set(entryResult.entries.map((entry) => entry.subscription.scope));
        for (const scope of scopeSet) {
          upcomingByScope.set(scope, context.services.contests.getUpcomingContests(scope));
        }
        const nowSeconds = Math.floor(Date.now() / 1000);

        const embed = buildSubscriptionListEmbed({
          title: "Contest reminder subscriptions",
          color: EMBED_COLORS.info,
          entries: entryResult.entries,
          formatEntry: (entry) =>
            `${formatSubscriptionSummary(
              entry.subscription,
              entry.channelStatus,
              entry.lastNotifiedAt
            )}\n${formatNextReminderLine(
              entry.subscription,
              getNextReminderInfo(entry.subscription, upcomingByScope, nowSeconds),
              refreshState.scopeErrors
            )}`,
        });

        if (refreshState.stale || refreshState.scopeErrors.size > 0) {
          const footerParts: string[] = [];
          if (refreshState.stale) {
            footerParts.push("Showing cached contest data due to a temporary error.");
          }
          if (refreshState.scopeErrors.size > 0) {
            footerParts.push("Contest data unavailable for one or more scopes.");
          }
          embed.setFooter({ text: footerParts.join(" ") });
        }

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (subcommand === "clear") {
        const removed = await context.services.contestReminders.clearSubscriptions(guildId);
        await interaction.reply({
          content: removed
            ? `Removed ${removed} contest reminder subscription${removed === 1 ? "" : "s"}.`
            : "No contest reminders were configured for this server.",
        });
        return;
      }

      if (subcommand === "cleanup") {
        const subscriptions = await context.services.contestReminders.listSubscriptions(guildId);
        const includePermissions = resolveBooleanOption(interaction, "include_permissions");
        const message = await runChannelCleanupSummary({
          client: context.client,
          subscriptions,
          includePermissions,
          removeSubscription: (id) =>
            context.services.contestReminders.removeSubscription(guildId, id),
          emptyMessage: NO_SUBSCRIPTIONS_MESSAGE,
          summary: {
            label: "contest reminder subscription",
            allGoodMessage: "All contest reminder channels look good.",
            cleanupHint: "Use /contestreminders cleanup include_permissions:true to remove them.",
          },
        });
        await interaction.reply({ content: message });
        return;
      }

      if (subcommand === "set" || subcommand === "add") {
        const channel = await resolveSendableChannelOrReply(
          interaction,
          context.client,
          interaction.options.getChannel("channel", true),
          { invalidTypeMessage: "Pick a text channel for contest reminders." }
        );
        if (!channel) {
          return;
        }
        const minutesBefore = interaction.options.getInteger("minutes_before") ?? DEFAULT_MINUTES;
        const role = interaction.options.getRole("role");
        const roleId = role?.id ?? null;
        const includeRaw = interaction.options.getString("include");
        const excludeRaw = interaction.options.getString("exclude");
        const filters = parseKeywordFilters(includeRaw, excludeRaw);
        const scope = parseContestScope(interaction.options.getString("scope"), DEFAULT_SCOPE);

        const subscription = await context.services.contestReminders.createSubscription(
          guildId,
          channel.id,
          minutesBefore,
          roleId,
          filters.includeKeywords,
          filters.excludeKeywords,
          scope
        );
        await interaction.reply({
          content: buildSubscriptionResponse({
            intro: "Contest reminders enabled",
            channelId: channel.id,
            minutesBefore,
            scope,
            roleId,
            includeKeywords: filters.includeKeywords,
            excludeKeywords: filters.excludeKeywords,
            subscriptionId: subscription.id,
          }),
        });
        return;
      }

      if (subcommand === "preset") {
        const channel = await resolveSendableChannelOrReply(
          interaction,
          context.client,
          interaction.options.getChannel("channel", true),
          { invalidTypeMessage: "Pick a text channel for contest reminders." }
        );
        if (!channel) {
          return;
        }
        const presetKey = interaction.options.getString("preset", true) as ContestReminderPreset;
        const preset = getContestReminderPreset(presetKey);
        const minutesBefore = interaction.options.getInteger("minutes_before") ?? DEFAULT_MINUTES;
        const role = interaction.options.getRole("role");
        const roleId = role?.id ?? null;
        const scope = parseContestScope(interaction.options.getString("scope"), DEFAULT_SCOPE);
        const subscription = await context.services.contestReminders.createSubscription(
          guildId,
          channel.id,
          minutesBefore,
          roleId,
          preset.includeKeywords,
          preset.excludeKeywords,
          scope
        );
        await interaction.reply({
          content: buildSubscriptionResponse({
            intro: `Contest reminder preset "${preset.label}" enabled`,
            channelId: channel.id,
            minutesBefore,
            scope,
            roleId,
            includeKeywords: preset.includeKeywords,
            excludeKeywords: preset.excludeKeywords,
            subscriptionId: subscription.id,
          }),
        });
        return;
      }

      if (subcommand === "remove") {
        const subscription = await resolveSubscription();
        if (!subscription) {
          return;
        }
        const removed = await context.services.contestReminders.removeSubscription(
          guildId,
          subscription.id
        );
        await interaction.reply({
          content: removed
            ? `Removed contest reminder subscription \`${subscription.id}\`.`
            : "Subscription not found.",
        });
        return;
      }

      if (subcommand === "preview") {
        const subscription = await resolveSubscription();
        if (!subscription) {
          return;
        }

        let stale = false;
        try {
          if (subscription.scope === "all") {
            const results = await Promise.allSettled([
              context.services.contests.refresh(false, "official"),
              context.services.contests.refresh(false, "gym"),
            ]);
            if (results.some((result) => result.status === "rejected")) {
              stale = true;
            }
          } else {
            await context.services.contests.refresh(false, subscription.scope);
          }
        } catch {
          const lastRefresh =
            subscription.scope === "all"
              ? context.services.contests.getLastRefreshAt("all")
              : context.services.contests.getLastRefreshAt(subscription.scope);
          if (lastRefresh > 0) {
            stale = true;
          } else {
            await interaction.reply({
              content: "Unable to reach Codeforces right now. Try again in a few minutes.",
            });
            return;
          }
        }

        const upcoming = context.services.contests.getUpcoming(10, subscription.scope);
        const filtered = filterContestsByKeywords(upcoming, {
          includeKeywords: subscription.includeKeywords,
          excludeKeywords: subscription.excludeKeywords,
        });
        if (filtered.length === 0) {
          await interaction.reply({ content: "No upcoming contests found." });
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
          .setColor(EMBED_COLORS.info)
          .addFields(
            { name: "Contest", value: contest.name, inline: false },
            { name: "Channel", value: `<#${subscription.channelId}>`, inline: true },
            {
              name: "Lead time",
              value: `${subscription.minutesBefore} minutes`,
              inline: true,
            },
            { name: "Scope", value: formatContestScopeLabel(subscription.scope), inline: true },
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

        appendSubscriptionIdField(embed, subscription.id);

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (subcommand === "post") {
        const force = resolveBooleanOption(interaction, "force");
        const subscription = await resolveSubscription();
        if (!subscription) {
          return;
        }
        await interaction.deferReply();
        const result = await context.services.contestReminders.sendManualReminder(
          subscription,
          context.client,
          force
        );

        if (result.status === "channel_missing_permissions") {
          await interaction.editReply(
            formatCannotPostPermissionsMessage(result.channelId, result.missingPermissions)
          );
          return;
        }

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
      await interaction.reply({ content: "Something went wrong." });
    }
  },
};
