import {
  ChannelType,
  type Client,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

import type { ContestReminder } from "../services/contestReminders.js";
import type { Contest, ContestScopeFilter } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  filterContestsByKeywords,
  getContestReminderPreset,
  listContestReminderPresets,
  parseKeywordFilters,
  serializeKeywords,
  type ContestReminderPreset,
} from "../utils/contestFilters.js";
import { addContestScopeOption, refreshContestData } from "../utils/contestScope.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import {
  describeSendableChannelStatus,
  getSendableChannelStatus,
  type SendableChannelStatus,
} from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { formatDiscordRelativeTime, formatDiscordTimestamp } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_MINUTES = 30;
const MIN_MINUTES = 5;
const MAX_MINUTES = 24 * 60;
const DEFAULT_SCOPE: ContestScopeFilter = "official";

type ChannelLike = { id: string; type: ChannelType };
type ReminderChannel = ChannelLike & {
  type: ChannelType.GuildText | ChannelType.GuildAnnouncement;
};

function normalizeScope(raw: string | null): ContestScopeFilter {
  if (raw === "official" || raw === "gym" || raw === "all") {
    return raw;
  }
  return DEFAULT_SCOPE;
}

function formatScope(scope: ContestScopeFilter): string {
  return scope === "official" ? "Official" : scope === "gym" ? "Gym" : "All";
}

function formatKeywordList(keywords: string[]): string {
  return keywords.length > 0 ? keywords.join(", ") : "None";
}

function isReminderChannel(channel: ChannelLike): channel is ReminderChannel {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

async function resolveReminderChannelOrReply(
  interaction: Parameters<Command["execute"]>[0],
  client: Client,
  channel: ChannelLike
): Promise<ReminderChannel | null> {
  if (!isReminderChannel(channel)) {
    await interaction.reply({
      content: "Pick a text channel for contest reminders.",
    });
    return null;
  }
  const status = await getSendableChannelStatus(client, channel.id);
  if (status.status !== "ok") {
    await interaction.reply({
      content: `I can't post in <#${channel.id}> (${describeSendableChannelStatus(
        status
      )}). Check the bot permissions and try again.`,
    });
    return null;
  }
  return channel;
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
  return `${input.intro} in <#${input.channelId}> (${input.minutesBefore} minutes before, ${formatScope(
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
  channelStatus?: SendableChannelStatus | null
): string {
  const include = formatKeywordList(subscription.includeKeywords);
  const exclude = formatKeywordList(subscription.excludeKeywords);
  const role = subscription.roleId ? `<@&${subscription.roleId}>` : "None";
  const statusLine = formatChannelStatus(channelStatus);
  const lines = [
    `Channel: <#${subscription.channelId}>`,
    ...(statusLine ? [statusLine] : []),
    `Lead time: ${subscription.minutesBefore} minutes`,
    `Scope: ${formatScope(subscription.scope)}`,
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

function addReminderOptions(
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
    .addRoleOption((option) => option.setName("role").setDescription("Role to mention for reminders"))
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
    .addStringOption((option) => addContestScopeOption(option, "Which contests to include"));
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

async function getSubscriptionsOrReply(
  interaction: Parameters<Command["execute"]>[0],
  contestReminders: { listSubscriptions: (guildId: string) => Promise<ContestReminder[]> },
  guildId: string
): Promise<ContestReminder[] | null> {
  const subscriptions = await contestReminders.listSubscriptions(guildId);
  if (subscriptions.length === 0) {
    await interaction.reply({
      content: "No contest reminders configured for this server.",
    });
    return null;
  }
  return subscriptions;
}

async function resolveSubscriptionIdOrReply(
  interaction: Parameters<Command["execute"]>[0],
  subscriptions: ContestReminder[],
  id: string
): Promise<string | null> {
  const resolution = resolveSubscriptionId(subscriptions, id);
  if (resolution.status === "not_found") {
    await interaction.reply({
      content: "Subscription id not found. Use /contestreminders list to see current ids.",
    });
    return null;
  }
  if (resolution.status === "ambiguous") {
    await interaction.reply({
      content: `Subscription id matches multiple entries. Use the full id. Matches: ${resolution.matches.join(
        ", "
      )}`,
    });
    return null;
  }
  return resolution.id;
}

async function selectSubscriptionOrReply(
  interaction: Parameters<Command["execute"]>[0],
  subscriptions: ContestReminder[],
  id: string | null,
  multiMessage: string
): Promise<ContestReminder | null> {
  if (id) {
    const resolvedId = await resolveSubscriptionIdOrReply(interaction, subscriptions, id);
    if (!resolvedId) {
      return null;
    }
    return subscriptions.find((entry) => entry.id === resolvedId) ?? subscriptions[0]!;
  }
  if (subscriptions.length > 1) {
    await interaction.reply({ content: multiMessage });
    return null;
  }
  return subscriptions[0] ?? null;
}

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
      subcommand.setName("status").setDescription("List current reminder subscriptions")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List current reminder subscriptions")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preset")
        .setDescription("Add a reminder preset (Div 2, Div 3, Div 4, Educational)")
        .addStringOption((option) => {
          const choice = option
            .setName("preset")
            .setDescription("Reminder preset")
            .setRequired(true);
          for (const preset of listContestReminderPresets()) {
            choice.addChoices({ name: preset.name, value: preset.value });
          }
          return choice;
        })
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
        .addStringOption((option) => addContestScopeOption(option, "Which contests to include"))
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
      });
      return;
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status" || subcommand === "list") {
        const subscriptions = await getSubscriptionsOrReply(
          interaction,
          context.services.contestReminders,
          guildId
        );
        if (!subscriptions) {
          return;
        }

        const refreshState = await refreshContestScopes(
          context.services.contests,
          subscriptions
        );
        const channelStatuses = await Promise.all(
          subscriptions.map((subscription) =>
            getSendableChannelStatus(context.client, subscription.channelId)
          )
        );
        const upcomingByScope = new Map<ContestScopeFilter, Contest[]>();
        const scopeSet = new Set(subscriptions.map((subscription) => subscription.scope));
        for (const scope of scopeSet) {
          upcomingByScope.set(scope, context.services.contests.getUpcomingContests(scope));
        }
        const nowSeconds = Math.floor(Date.now() / 1000);

        const embed = new EmbedBuilder()
          .setTitle("Contest reminder subscriptions")
          .setColor(EMBED_COLORS.info)
          .addFields(
            subscriptions.map((subscription, index) => ({
              name: `Subscription ${index + 1}`,
              value: `${formatSubscriptionSummary(
                subscription,
                channelStatuses[index]
              )}\n${formatNextReminderLine(
                subscription,
                getNextReminderInfo(subscription, upcomingByScope, nowSeconds),
                refreshState.scopeErrors
              )}`,
              inline: false,
            }))
          );

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

      if (subcommand === "set" || subcommand === "add") {
        const channel = await resolveReminderChannelOrReply(
          interaction,
          context.client,
          interaction.options.getChannel("channel", true)
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
        const scope = normalizeScope(interaction.options.getString("scope"));

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
        const channel = await resolveReminderChannelOrReply(
          interaction,
          context.client,
          interaction.options.getChannel("channel", true)
        );
        if (!channel) {
          return;
        }
        const presetKey = interaction.options.getString("preset", true) as ContestReminderPreset;
        const preset = getContestReminderPreset(presetKey);
        const minutesBefore = interaction.options.getInteger("minutes_before") ?? DEFAULT_MINUTES;
        const role = interaction.options.getRole("role");
        const roleId = role?.id ?? null;
        const scope = normalizeScope(interaction.options.getString("scope"));
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
        const id = interaction.options.getString("id", true);
        const subscriptions = await getSubscriptionsOrReply(
          interaction,
          context.services.contestReminders,
          guildId
        );
        if (!subscriptions) {
          return;
        }
        const resolvedId = await resolveSubscriptionIdOrReply(interaction, subscriptions, id);
        if (!resolvedId) {
          return;
        }
        const removed = await context.services.contestReminders.removeSubscription(
          guildId,
          resolvedId
        );
        await interaction.reply({
          content: removed
            ? `Removed contest reminder subscription \`${resolvedId}\`.`
            : "Subscription not found.",
        });
        return;
      }

      if (subcommand === "preview") {
        const id = interaction.options.getString("id");
        const subscriptions = await getSubscriptionsOrReply(
          interaction,
          context.services.contestReminders,
          guildId
        );
        if (!subscriptions) {
          return;
        }
        const subscription = await selectSubscriptionOrReply(
          interaction,
          subscriptions,
          id,
          "Multiple contest reminder subscriptions are configured. Provide an id from /contestreminders list."
        );
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
            { name: "Scope", value: formatScope(subscription.scope), inline: true },
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

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (subcommand === "post") {
        const force = interaction.options.getBoolean("force") ?? false;
        const id = interaction.options.getString("id");
        const subscriptions = await getSubscriptionsOrReply(
          interaction,
          context.services.contestReminders,
          guildId
        );
        if (!subscriptions) {
          return;
        }
        const subscription = await selectSubscriptionOrReply(
          interaction,
          subscriptions,
          id,
          "Multiple contest reminder subscriptions are configured. Provide an id from /contestreminders list."
        );
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
            `I can't post in <#${result.channelId}> (${describeSendableChannelStatus({
              status: "missing_permissions",
              channelId: result.channelId,
              missingPermissions: result.missingPermissions,
            })}). Check the bot permissions and try again.`
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
