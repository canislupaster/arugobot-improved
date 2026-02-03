import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import {
  buildContestRatingAlertEmbed,
  type ContestRatingAlertSubscription,
} from "../services/contestRatingAlerts.js";
import { cleanupChannelSubscriptions, formatIdList } from "../utils/channelCleanup.js";
import { logCommandError } from "../utils/commandLogging.js";
import {
  describeSendableChannelStatus,
  formatCannotPostMessage,
  getSendableChannelStatus,
  type SendableChannelStatus,
} from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { parseHandleFilterInput } from "../utils/handles.js";

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
const MULTIPLE_SUBSCRIPTIONS_MESSAGE =
  "Multiple contest rating alerts are configured. Provide an id from /contestratingalerts list.";

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

function selectSubscription(
  subscriptions: ContestRatingAlertSubscription[],
  inputId: string | null
):
  | { status: "none" }
  | { status: "needs_id" }
  | { status: "not_found" }
  | { status: "ambiguous"; matches: string[] }
  | { status: "ok"; subscription: ContestRatingAlertSubscription } {
  if (subscriptions.length === 0) {
    return { status: "none" };
  }
  if (!inputId) {
    if (subscriptions.length > 1) {
      return { status: "needs_id" };
    }
    return { status: "ok", subscription: subscriptions[0]! };
  }
  const resolution = resolveSubscriptionId(subscriptions, inputId);
  if (resolution.status !== "ok") {
    return resolution;
  }
  const subscription =
    subscriptions.find((entry) => entry.id === resolution.id) ?? subscriptions[0]!;
  return { status: "ok", subscription };
}

export const contestRatingAlertsCommand: Command = {
  data: new SlashCommandBuilder()
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
      subcommand.setName("status").setDescription("List current rating alert subscriptions")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List current rating alert subscriptions")
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
      subcommand
        .setName("cleanup")
        .setDescription("Remove rating alerts targeting deleted channels")
        .addBooleanOption((option) =>
          option
            .setName("include_permissions")
            .setDescription("Also remove subscriptions where the bot lacks permissions")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preview")
        .setDescription("Preview the next contest rating change alert")
        .addStringOption((option) =>
          option.setName("id").setDescription("Subscription id (from list)")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("post")
        .setDescription("Post the latest contest rating changes immediately")
        .addBooleanOption((option) =>
          option.setName("force").setDescription("Send even if an alert was already posted")
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
        const subscriptions = await context.services.contestRatingAlerts.listSubscriptions(guildId);
        if (subscriptions.length === 0) {
          await interaction.reply({
            content: NO_SUBSCRIPTIONS_MESSAGE,
          });
          return;
        }
        const lastNotifiedMap = await context.services.contestRatingAlerts.getLastNotificationMap(
          subscriptions.map((subscription) => subscription.id)
        );
        const channelStatuses = await Promise.all(
          subscriptions.map((subscription) =>
            getSendableChannelStatus(context.client, subscription.channelId)
          )
        );

        const embed = new EmbedBuilder()
          .setTitle("Contest rating alert subscriptions")
          .setColor(EMBED_COLORS.info)
          .addFields(
            subscriptions.map((subscription, index) => ({
              name: `Subscription ${index + 1}`,
              value: formatSubscriptionSummary(
                subscription,
                channelStatuses[index],
                lastNotifiedMap.get(subscription.id) ?? null
              ),
              inline: false,
            }))
          );

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
        if (subscriptions.length === 0) {
          await interaction.reply({
            content: NO_SUBSCRIPTIONS_MESSAGE,
          });
          return;
        }

        const includePermissions = interaction.options.getBoolean?.("include_permissions") ?? false;
        const cleanup = await cleanupChannelSubscriptions({
          client: context.client,
          subscriptions,
          includePermissions,
          removeSubscription: (id) =>
            context.services.contestRatingAlerts.removeSubscription(guildId, id),
        });
        const {
          removedIds,
          removedPermissionIds,
          failedIds,
          failedPermissionIds,
          permissionIssues,
        } = cleanup;

        if (
          removedIds.length === 0 &&
          removedPermissionIds.length === 0 &&
          failedIds.length === 0 &&
          failedPermissionIds.length === 0 &&
          permissionIssues.length === 0
        ) {
          await interaction.reply({
            content: "All contest rating alert channels look good.",
          });
          return;
        }

        const lines: string[] = [];
        if (removedIds.length > 0) {
          lines.push(
            `Removed ${removedIds.length} contest rating alert subscription${
              removedIds.length === 1 ? "" : "s"
            } with missing channels: ${formatIdList(removedIds)}.`
          );
        }
        if (removedPermissionIds.length > 0) {
          lines.push(
            `Removed ${removedPermissionIds.length} contest rating alert subscription${
              removedPermissionIds.length === 1 ? "" : "s"
            } with missing permissions: ${formatIdList(removedPermissionIds)}.`
          );
        }
        if (failedIds.length > 0) {
          lines.push(
            `Failed to remove ${failedIds.length} subscription${failedIds.length === 1 ? "" : "s"}: ${formatIdList(
              failedIds
            )}.`
          );
        }
        if (failedPermissionIds.length > 0) {
          lines.push(
            `Failed to remove ${failedPermissionIds.length} subscription${
              failedPermissionIds.length === 1 ? "" : "s"
            } with missing permissions: ${formatIdList(failedPermissionIds)}.`
          );
        }
        if (permissionIssues.length > 0) {
          const issueLines = permissionIssues.map(
            (issue) =>
              `${formatIdList([issue.id])} (<#${issue.channelId}>): ${describeSendableChannelStatus(
                issue.status
              )}`
          );
          lines.push(
            `Subscriptions with missing permissions (not removed): ${issueLines.join("; ")}.`
          );
        }

        await interaction.reply({ content: lines.join("\n") });
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
        const id = interaction.options.getString("id", true);
        const subscriptions = await context.services.contestRatingAlerts.listSubscriptions(guildId);
        if (subscriptions.length === 0) {
          await interaction.reply({
            content: NO_SUBSCRIPTIONS_MESSAGE,
          });
          return;
        }
        const resolution = resolveSubscriptionId(subscriptions, id);
        if (resolution.status === "not_found") {
          await interaction.reply({
            content: "Subscription id not found. Use /contestratingalerts list to see current ids.",
          });
          return;
        }
        if (resolution.status === "ambiguous") {
          await interaction.reply({
            content: `Subscription id matches multiple entries. Use the full id. Matches: ${resolution.matches.join(
              ", "
            )}`,
          });
          return;
        }
        const removed = await context.services.contestRatingAlerts.removeSubscription(
          guildId,
          resolution.id
        );
        await interaction.reply({
          content: removed
            ? `Removed contest rating alert subscription \`${resolution.id}\`.`
            : "Subscription not found.",
        });
        return;
      }

      if (subcommand === "preview") {
        const id = interaction.options.getString("id");
        const subscriptions = await context.services.contestRatingAlerts.listSubscriptions(guildId);
        const selection = selectSubscription(subscriptions, id);
        if (selection.status === "none") {
          await interaction.reply({ content: NO_SUBSCRIPTIONS_MESSAGE });
          return;
        }
        if (selection.status === "needs_id") {
          await interaction.reply({ content: MULTIPLE_SUBSCRIPTIONS_MESSAGE });
          return;
        }
        if (selection.status === "not_found") {
          await interaction.reply({
            content: "Subscription id not found. Use /contestratingalerts list to see current ids.",
          });
          return;
        }
        if (selection.status === "ambiguous") {
          await interaction.reply({
            content: `Subscription id matches multiple entries. Use the full id. Matches: ${selection.matches.join(
              ", "
            )}`,
          });
          return;
        }
        const { subscription } = selection;

        const preview = await context.services.contestRatingAlerts.getPreview(subscription);
        if (preview.status === "no_handles") {
          await interaction.reply({
            content: "No linked handles found in this server yet.",
          });
          return;
        }
        if (preview.status === "no_matching_handles") {
          await interaction.reply({
            content: "No linked handles match the alert filters.",
          });
          return;
        }
        if (preview.status === "no_contest") {
          await interaction.reply({
            content: "No finished contests found yet.",
          });
          return;
        }
        if (preview.status === "no_changes") {
          await interaction.reply({
            content: `No rating changes found for ${preview.contest.name} yet.`,
          });
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

        const embed = buildContestRatingAlertEmbed(preview.preview);
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
        const subscriptions = await context.services.contestRatingAlerts.listSubscriptions(guildId);
        const selection = selectSubscription(subscriptions, id);
        if (selection.status === "none") {
          await interaction.reply({ content: NO_SUBSCRIPTIONS_MESSAGE });
          return;
        }
        if (selection.status === "needs_id") {
          await interaction.reply({ content: MULTIPLE_SUBSCRIPTIONS_MESSAGE });
          return;
        }
        if (selection.status === "not_found") {
          await interaction.reply({
            content: "Subscription id not found. Use /contestratingalerts list to see current ids.",
          });
          return;
        }
        if (selection.status === "ambiguous") {
          await interaction.reply({
            content: `Subscription id matches multiple entries. Use the full id. Matches: ${selection.matches.join(
              ", "
            )}`,
          });
          return;
        }
        const { subscription } = selection;

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
        if (result.status === "no_handles") {
          await interaction.editReply("No linked handles found in this server yet.");
          return;
        }
        if (result.status === "no_matching_handles") {
          await interaction.editReply("No linked handles match the alert filters.");
          return;
        }
        if (result.status === "no_contest") {
          await interaction.editReply("No finished contests found yet.");
          return;
        }
        if (result.status === "no_changes") {
          await interaction.editReply(`No rating changes found for ${result.contestName} yet.`);
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
