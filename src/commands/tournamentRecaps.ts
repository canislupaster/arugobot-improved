import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import { cleanupSingleChannelSubscription } from "../utils/channelCleanup.js";
import { logCommandError } from "../utils/commandLogging.js";
import { addCleanupSubcommand } from "../utils/commandOptions.js";
import {
  describeSendableChannelStatus,
  formatCannotPostPermissionsMessage,
  resolveSendableChannelOrReply,
} from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import {
  requireGuildAndSubcommand,
  safeInteractionEdit,
  safeInteractionReply,
} from "../utils/interaction.js";

import type { Command } from "./types.js";

const NO_SUBSCRIPTION_MESSAGE = "No tournament recap auto-posts configured for this server.";
const POST_RESPONSE_MESSAGES: Record<
  "no_subscription" | "no_completed" | "channel_missing" | "recap_missing",
  string
> = {
  no_subscription: NO_SUBSCRIPTION_MESSAGE,
  no_completed: "No completed tournaments to recap.",
  channel_missing: "Recap channel is missing; use /tournamentrecaps set to update the channel.",
  recap_missing: "Unable to build a recap for the latest tournament.",
};

export const tournamentRecapsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("tournamentrecaps")
    .setDescription("Configure automatic tournament recap posts")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Enable tournament recap auto-posts")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to post recaps in")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role to mention when posting recaps")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show current recap settings")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Disable automatic recap posts")
    )
    .addSubcommand((subcommand) =>
      addCleanupSubcommand(
        subcommand,
        "Remove recap settings pointing at missing channels"
      )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("post").setDescription("Post the latest completed tournament recap")
  ),
  adminOnly: true,
  async execute(interaction, context) {
    const commandContext = await requireGuildAndSubcommand(interaction, {
      content: "This command can only be used in a server.",
    });
    if (!commandContext) {
      return;
    }

    const { guild, subcommand } = commandContext;
    const guildId = guild.id;
    const replyWithContent = async (content: string) => {
      await safeInteractionReply(interaction, { content });
    };

    const buildStatusEmbed = (subscription: { channelId: string; roleId: string | null }) =>
      new EmbedBuilder()
        .setTitle("Tournament recap auto-posts")
        .setColor(EMBED_COLORS.info)
        .addFields(
          { name: "Channel", value: `<#${subscription.channelId}>`, inline: true },
          ...(subscription.roleId
            ? [{ name: "Role", value: `<@&${subscription.roleId}>`, inline: true }]
            : [])
        );

    try {
      switch (subcommand) {
        case "status": {
          const subscription = await context.services.tournamentRecaps.getSubscription(guildId);
          if (!subscription) {
            await replyWithContent(NO_SUBSCRIPTION_MESSAGE);
            return;
          }

          const embed = buildStatusEmbed(subscription);
          await interaction.reply({ embeds: [embed] });
          return;
        }
        case "clear": {
          const removed = await context.services.tournamentRecaps.clearSubscription(guildId);
          await replyWithContent(
            removed
              ? "Tournament recap auto-posts disabled for this server."
              : "No tournament recap auto-posts were configured for this server."
          );
          return;
        }
        case "cleanup": {
          const subscription = await context.services.tournamentRecaps.getSubscription(guildId);
          if (!subscription) {
            await replyWithContent(NO_SUBSCRIPTION_MESSAGE);
            return;
          }
          const includePermissions =
            interaction.options.getBoolean("include_permissions") ?? false;
          const replyMessage = await cleanupSingleChannelSubscription({
            client: context.client,
            channelId: subscription.channelId,
            includePermissions,
            healthyMessage: "Tournament recap channel looks healthy; nothing to clean.",
            missingPermissionsMessage: (status) =>
              `Tournament recaps still point at <#${subscription.channelId}> (${describeSendableChannelStatus(
                status
              )}). Re-run with include_permissions:true or update the channel with /tournamentrecaps set.`,
            remove: () => context.services.tournamentRecaps.clearSubscription(guildId),
            removedMessage: (status) =>
              `Removed tournament recap settings for <#${subscription.channelId}> (${describeSendableChannelStatus(
                status
              )}).`,
            failedMessage: "Failed to remove tournament recap settings. Try again later.",
          });
          await replyWithContent(replyMessage);
          return;
        }
        case "set": {
          const channel = await resolveSendableChannelOrReply(
            interaction,
            context.client,
            interaction.options.getChannel("channel", true),
            { invalidTypeMessage: "Pick a text channel for tournament recaps." }
          );
          if (!channel) {
            return;
          }
          const role = interaction.options.getRole("role");
          const roleId = role?.id ?? null;
          await context.services.tournamentRecaps.setSubscription(guildId, channel.id, roleId);
          const roleLabel = roleId ? ` (mentioning <@&${roleId}>)` : "";
          await replyWithContent(
            `Tournament recaps will auto-post in <#${channel.id}>${roleLabel}.`
          );
          return;
        }
        case "post": {
          await interaction.deferReply();
          const result = await context.services.tournamentRecaps.postLatestCompletedRecap(
            guildId,
            context.client
          );
          if (result.status === "error") {
            await safeInteractionEdit(interaction, `Failed to post recap: ${result.message}`);
            return;
          }
          if (result.status === "channel_missing_permissions") {
            await safeInteractionEdit(
              interaction,
              formatCannotPostPermissionsMessage(result.channelId, result.missingPermissions)
            );
            return;
          }
          if (result.status !== "sent") {
            await safeInteractionEdit(interaction, POST_RESPONSE_MESSAGES[result.status]);
            return;
          }
          await safeInteractionEdit(
            interaction,
            `Tournament recap posted in <#${result.channelId}>.`
          );
          return;
        }
        default:
          return;
      }
    } catch (error) {
      logCommandError(
        `Tournament recap command failed: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await safeInteractionReply(interaction, { content: "Something went wrong." });
    }
  },
};
