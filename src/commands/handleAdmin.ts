import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { privateFlags } from "../utils/discordFlags.js";

import type { Command } from "./types.js";

export const handleAdminCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("handleadmin")
    .setDescription("Admin management for linked Codeforces handles")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Link or update a user's handle")
        .addUserOption((option) =>
          option.setName("user").setDescription("User to link").setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("handle").setDescription("Codeforces handle").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unlink")
        .setDescription("Remove a user's linked handle")
        .addUserOption((option) =>
          option.setName("user").setDescription("User to unlink").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show a user's linked handle")
        .addUserOption((option) =>
          option.setName("user").setDescription("User to inspect").setRequired(true)
        )
    ),
  adminOnly: true,
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ...privateFlags,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ ...privateFlags });

    try {
      if (subcommand === "status") {
        const user = interaction.options.getUser("user", true);
        const handle = await context.services.store.getHandle(guildId, user.id);
        if (!handle) {
          await interaction.editReply(`No handle linked for <@${user.id}>.`);
          return;
        }
        await interaction.editReply(`Handle for <@${user.id}> is ${handle}.`);
        return;
      }

      if (subcommand === "unlink") {
        const user = interaction.options.getUser("user", true);
        const handle = await context.services.store.getHandle(guildId, user.id);
        if (!handle) {
          await interaction.editReply(`No handle linked for <@${user.id}>.`);
          return;
        }
        await context.services.store.unlinkUser(guildId, user.id);
        await interaction.editReply(`Unlinked handle for <@${user.id}> (${handle}).`);
        return;
      }

      if (subcommand === "set") {
        const user = interaction.options.getUser("user", true);
        const handleInput = interaction.options.getString("handle", true).trim();
        const handleInfo = await context.services.store.resolveHandle(handleInput);
        if (!handleInfo.exists) {
          await interaction.editReply("Invalid handle.");
          return;
        }
        const resolvedHandle = handleInfo.canonicalHandle ?? handleInput;
        const currentHandle = await context.services.store.getHandle(guildId, user.id);
        if (currentHandle) {
          if (currentHandle.toLowerCase() === resolvedHandle.toLowerCase()) {
            await interaction.editReply("That handle is already linked.");
            return;
          }
          const updateResult = await context.services.store.updateUserHandle(
            guildId,
            user.id,
            resolvedHandle
          );
          if (updateResult === "ok") {
            await interaction.editReply(`Updated handle for <@${user.id}> to ${resolvedHandle}.`);
            return;
          }
          if (updateResult === "handle_exists") {
            await interaction.editReply("Handle taken in this server.");
            return;
          }
          await interaction.editReply("Unable to update handle right now.");
          return;
        }

        const insertResult = await context.services.store.insertUser(
          guildId,
          user.id,
          resolvedHandle
        );
        if (insertResult === "ok") {
          await interaction.editReply(`Linked handle for <@${user.id}> set to ${resolvedHandle}.`);
          return;
        }
        if (insertResult === "handle_exists") {
          await interaction.editReply("Handle taken in this server.");
          return;
        }
        if (insertResult === "already_linked") {
          await interaction.editReply("That user already linked a handle.");
          return;
        }
        await interaction.editReply("Unable to link handle right now.");
        return;
      }
    } catch (error) {
      logCommandError(`Handle admin failed: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
