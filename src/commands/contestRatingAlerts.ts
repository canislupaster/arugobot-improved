import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import {
  buildContestRatingAlertEmbed,
  type ContestRatingAlertSubscription,
} from "../services/contestRatingAlerts.js";
import { runChannelCleanupSummary } from "../utils/channelCleanup.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  addCleanupSubcommand,
  addPreviewAndPostSubcommands,
  buildPreviewPostOptions,
} from "../utils/commandOptions.js";
import {
  describeSendableChannelStatus,
  formatCannotPostMessage,
  getSendableChannelStatus,
  type SendableChannelStatus,
} from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { parseHandleFilterInput } from "../utils/handles.js";
import { requireGuild, resolveBooleanOption } from "../utils/interaction.js";
import {
  appendSubscriptionIdField,
  createSubscriptionSelectionResolver,
} from "../utils/subscriptionSelection.js";
import {
  buildSubscriptionListEmbed,
  resolveSubscriptionEntriesFromService,
} from "../utils/subscriptionStatus.js";

import type { Command } from "./types.js";

function formatChannelStatus(status?: SendableChannelStatus | null): string | null {
  if (!status || status.status === "ok") {
    return null;
  }
  return `Channel status: ${describeSendableChannelStatus(status)}`;
}

function formatSubscriptionSummary(
  subscription: ContestRatingAlertSubscription,
  channelStatus?: SendableChannelStatus | null,
  lastNotifiedAt?: string | null
): string {
  const role = subscription.roleId ? `<@&${subscription.roleId}>` : "None";
  const minDelta = subscription.minDelta > 0 ? String(subscription.minDelta) : "None";
  const handles =
    subscription.includeHandles.length > 0
      ? subscription.includeHandles.join(", ")
      : "All linked handles";
  const statusLine = formatChannelStatus(channelStatus);
  const lastSentLine = `Last sent: ${lastNotifiedAt ?? "Never"}`;
  const lines = [
    `Channel: <#${subscription.channelId}>`,
    ...(statusLine ? [statusLine] : []),
    lastSentLine,
    `Role: ${role}`,
    `Min delta: ${minDelta}`,
    `Handles: ${handles}`,
    `ID: \`${subscription.id}\``,
  ];
  return lines.join("\n");
}

const NO_SUBSCRIPTIONS_MESSAGE = "No contest rating alerts configured for this server.";
const NO_ISSUES_MESSAGE = "All contest rating alert subscriptions are healthy.";
const MULTIPLE_SUBSCRIPTIONS_MESSAGE =
  "Multiple contest rating alerts are configured. Provide an id from /contestratingalerts list.";
const selectionMessages = {
  none: NO_SUBSCRIPTIONS_MESSAGE,
  needsId: MULTIPLE_SUBSCRIPTIONS_MESSAGE,
  notFound: "Subscription id not found. Use /contestratingalerts list to see current ids.",
  ambiguous: (matches: string[]) =>
    `Subscription id matches multiple entries. Use the full id. Matches: ${matches.join(", ")}`,
};
const previewPostOptions = buildPreviewPostOptions({
  previewDescription: "Preview the next contest rating change alert",
  postDescription: "Post the latest contest rating changes immediately",
  forceDescription: "Send even if an alert was already posted",
  previewIdDescription: "Subscription id (from list)",
  postIdDescription: "Subscription id (from list)",
});

function getAlertStatusMessage(status: string, contestName?: string): string | null {
  switch (status) {
    case "no_handles":
      return "No linked handles found in this server yet.";
    case "no_matching_handles":
      return "No linked handles match the alert filters.";
    case "no_contest":
      return "No finished contests found yet.";
    case "no_changes":
      return `No rating changes found for ${contestName ?? "this contest"} yet.`;
    default:
      return null;
  }
}

export const contestRatingAlertsCommand: Command = {
  data: addPreviewAndPostSubcommands(
    new SlashCommandBuilder()
      .setName("contestratingalerts")
      .setDescription("Configure contest rating change alerts for this server")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((subcommand) =>
        subcommand
          .setName("set")
          .setDescription("Enable contest rating change alerts in a channel")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("Channel to post rating change alerts in")
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          )
          .addRoleOption((option) =>
            option.setName("role").setDescription("Role to mention for alerts")
          )
          .addIntegerOption((option) =>
            option
              .setName("min_delta")
              .setDescription("Minimum rating delta to include in alerts")
              .setMinValue(0)
          )
          .addStringOption((option) =>
            option
              .setName("handles")
              .setDescription("Comma-separated handles to include (linked handles only)")
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("status")
          .setDescription("List current rating alert subscriptions")
          .addBooleanOption((option) =>
            option
              .setName("only_issues")
              .setDescription("Only show alerts with missing channels or permissions")
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("list")
          .setDescription("List current rating alert subscriptions")
          .addBooleanOption((option) =>
            option
              .setName("only_issues")
              .setDescription("Only show alerts with missing channels or permissions")
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("remove")
          .setDescription("Remove a rating change alert subscription")
          .addStringOption((option) =>
            option.setName("id").setDescription("Subscription id (from list)").setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("clear").setDescription("Remove all rating change alerts")
      )
      .addSubcommand((subcommand) =>
        addCleanupSubcommand(
          subcommand,
          "Remove rating alerts targeting deleted channels",
          "Also remove subscriptions where the bot lacks permissions"
        )
      ),
    previewPostOptions
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
    const selectSubscription = createSubscriptionSelectionResolver(
      interaction,
      () => context.services.contestRatingAlerts.listSubscriptions(guildId),
      selectionMessages
    );

    try {
      if (subcommand === "status" || subcommand === "list") {
        const onlyIssues = resolveBooleanOption(interaction, "only_issues");
        const entryResult = await resolveSubscriptionEntriesFromService(
          interaction,
          context.client,
          () => context.services.contestRatingAlerts.listSubscriptions(guildId),
          (ids) => context.services.contestRatingAlerts.getLastNotificationMap(ids),
          onlyIssues,
          { noSubscriptions: NO_SUBSCRIPTIONS_MESSAGE, noIssues: NO_ISSUES_MESSAGE }
        );
        if (entryResult.status === "replied") {
          return;
        }
        const embed = buildSubscriptionListEmbed({
          title: "Contest rating alert subscriptions",
          color: EMBED_COLORS.info,
          entries: entryResult.entries,
          formatEntry: (entry) =>
            formatSubscriptionSummary(
              entry.subscription,
              entry.channelStatus,
              entry.lastNotifiedAt
            ),
        });

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (subcommand === "clear") {
        const removed = await context.services.contestRatingAlerts.clearSubscriptions(guildId);
        await interaction.reply({
          content: removed
            ? `Removed ${removed} contest rating alert subscription${removed === 1 ? "" : "s"}.`
            : "No contest rating alerts were configured for this server.",
        });
        return;
      }

      if (subcommand === "cleanup") {
        const subscriptions = await context.services.contestRatingAlerts.listSubscriptions(guildId);
        const includePermissions = resolveBooleanOption(interaction, "include_permissions");
        const message = await runChannelCleanupSummary({
          client: context.client,
          subscriptions,
          includePermissions,
          removeSubscription: (id) =>
            context.services.contestRatingAlerts.removeSubscription(guildId, id),
          emptyMessage: NO_SUBSCRIPTIONS_MESSAGE,
          summary: {
            label: "contest rating alert subscription",
            allGoodMessage: "All contest rating alert channels look good.",
            cleanupHint:
              "Use /contestratingalerts cleanup include_permissions:true to remove them.",
          },
        });
        await interaction.reply({ content: message });
        return;
      }

      if (subcommand === "set") {
        const channel = interaction.options.getChannel("channel", true);
        if (
          channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement
        ) {
          await interaction.reply({
            content: "Pick a text channel for contest rating alerts.",
          });
          return;
        }
        const status = await getSendableChannelStatus(context.client, channel.id);
        if (status.status !== "ok") {
          await interaction.reply({
            content: formatCannotPostMessage(channel.id, status),
          });
          return;
        }
        const role = interaction.options.getRole("role");
        const roleId = role?.id ?? null;
        const minDelta = interaction.options.getInteger("min_delta") ?? 0;
        const handleFilter = parseHandleFilterInput(interaction.options.getString("handles"));

        const subscription = await context.services.contestRatingAlerts.createSubscription(
          guildId,
          channel.id,
          roleId,
          {
            minDelta,
            includeHandles: handleFilter,
          }
        );
        const roleMention = roleId ? ` (mentioning <@&${roleId}>)` : "";
        const filterParts = [
          minDelta > 0 ? `min delta ${minDelta}` : null,
          handleFilter.length > 0 ? `handles ${handleFilter.join(", ")}` : null,
        ].filter(Boolean);
        const filterNote = filterParts.length > 0 ? ` Filters: ${filterParts.join("; ")}.` : "";
        await interaction.reply({
          content: `Contest rating alerts enabled in <#${channel.id}>${roleMention}. Subscription id: \`${subscription.id}\`.${filterNote}`,
        });
        return;
      }

      if (subcommand === "remove") {
        const subscription = await selectSubscription();
        if (!subscription) {
          return;
        }
        const removed = await context.services.contestRatingAlerts.removeSubscription(
          guildId,
          subscription.id
        );
        await interaction.reply({
          content: removed
            ? `Removed contest rating alert subscription \`${subscription.id}\`.`
            : "Subscription not found.",
        });
        return;
      }

      if (subcommand === "preview") {
        const subscription = await selectSubscription();
        if (!subscription) {
          return;
        }

        const preview = await context.services.contestRatingAlerts.getPreview(subscription);
        const previewStatusMessage = getAlertStatusMessage(
          preview.status,
          preview.status === "no_changes" ? preview.contest.name : undefined
        );
        if (previewStatusMessage) {
          await interaction.reply({ content: previewStatusMessage });
          return;
        }
        if (preview.status === "already_notified") {
          await interaction.reply({
            content: `Rating changes for ${preview.contest.name} were already posted at ${preview.notifiedAt}. Use /contestratingalerts post force:true to send another.`,
          });
          return;
        }
        if (preview.status === "error") {
          await interaction.reply({
            content: "Unable to load contest data right now. Try again later.",
          });
          return;
        }
        if (preview.status !== "ready") {
          await interaction.reply({
            content: "Unable to load contest data right now. Try again later.",
          });
          return;
        }

        const embed = buildContestRatingAlertEmbed(preview.preview);
        appendSubscriptionIdField(embed, subscription.id);
        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (subcommand === "post") {
        const force = resolveBooleanOption(interaction, "force");
        const subscription = await selectSubscription();
        if (!subscription) {
          return;
        }

        await interaction.deferReply();
        const result = await context.services.contestRatingAlerts.sendManualAlert(
          subscription,
          context.client,
          force
        );

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
            "Configured channel is missing or invalid. Use /contestratingalerts list + remove, then add a new subscription."
          );
          return;
        }
        const resultStatusMessage = getAlertStatusMessage(
          result.status,
          result.status === "no_changes" ? result.contestName : undefined
        );
        if (resultStatusMessage) {
          await interaction.editReply(resultStatusMessage);
          return;
        }
        if (result.status === "already_notified") {
          await interaction.editReply(
            `Rating changes for ${result.contestName} were already posted at ${result.notifiedAt}. Use force to send another.`
          );
          return;
        }
        if (result.status === "sent") {
          const staleNote = result.isStale ? " (used cached contest data)" : "";
          await interaction.editReply(
            `Posted rating changes for ${result.contestName} in <#${result.channelId}>.${staleNote}`
          );
          return;
        }

        await interaction.editReply(
          "Unable to send contest rating alerts right now. Try again later."
        );
        return;
      }
    } catch (error) {
      logCommandError(
        `Contest rating alerts failed: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.reply({ content: "Something went wrong." });
    }
  },
};
