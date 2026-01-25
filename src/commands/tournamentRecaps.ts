import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";

import type { Command } from "./types.js";

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
      subcommand.setName("post").setDescription("Post the latest completed tournament recap")
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
    const noSubscriptionMessage = "No tournament recap auto-posts configured for this server.";
    const postResponses: Record<
      "no_subscription" | "no_completed" | "channel_missing" | "recap_missing",
      string
    > = {
      no_subscription: noSubscriptionMessage,
      no_completed: "No completed tournaments to recap.",
      channel_missing: "Recap channel is missing; use /tournamentrecaps set to update the channel.",
      recap_missing: "Unable to build a recap for the latest tournament.",
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
      if (subcommand === "status") {
        const subscription = await context.services.tournamentRecaps.getSubscription(guildId);
        if (!subscription) {
          await interaction.reply({
            content: noSubscriptionMessage,
          });
          return;
        }

        const embed = buildStatusEmbed(subscription);

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (subcommand === "clear") {
        const removed = await context.services.tournamentRecaps.clearSubscription(guildId);
        await interaction.reply({
          content: removed
            ? "Tournament recap auto-posts disabled for this server."
            : "No tournament recap auto-posts were configured for this server.",
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
            content: "Pick a text channel for tournament recaps.",
          });
          return;
        }
        const role = interaction.options.getRole("role");
        const roleId = role?.id ?? null;
        await context.services.tournamentRecaps.setSubscription(guildId, channel.id, roleId);
        const roleLabel = roleId ? ` (mentioning <@&${roleId}>)` : "";
        await interaction.reply({
          content: `Tournament recaps will auto-post in <#${channel.id}>${roleLabel}.`,
        });
        return;
      }

      if (subcommand === "post") {
        await interaction.deferReply();
        const result = await context.services.tournamentRecaps.postLatestCompletedRecap(
          guildId,
          context.client
        );
        if (result.status === "error") {
          await interaction.editReply(`Failed to post recap: ${result.message}`);
          return;
        }
        if (result.status !== "sent") {
          await interaction.editReply(postResponses[result.status]);
          return;
        }
        await interaction.editReply(`Tournament recap posted in <#${result.channelId}>.`);
      }
    } catch (error) {
      logCommandError(
        `Tournament recap command failed: ${String(error)}`,
        interaction,
        context.correlationId
      );
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Something went wrong." });
      } else {
        await interaction.reply({ content: "Something went wrong." });
      }
    }
  },
};
