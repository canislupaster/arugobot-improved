import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import type { CommandContext } from "../types/commandContext.js";
import { logCommandError } from "../utils/commandLogging.js";
import { requireGuildEphemeral } from "../utils/interaction.js";

import type { Command } from "./types.js";

type StoreService = CommandContext["services"]["store"];
type HandleInsertResult = "ok" | "handle_exists" | "already_linked" | "error";
type HandleUpdateResult = "ok" | "not_linked" | "handle_exists" | "error";

const formatNoHandleMessage = (userId: string) => `No handle linked for <@${userId}>.`;

const resolveCanonicalHandle = async (
  interaction: ChatInputCommandInteraction,
  store: StoreService
): Promise<string | null> => {
  const handleInput = interaction.options.getString("handle", true).trim();
  const handleInfo = await store.resolveHandle(handleInput);
  if (!handleInfo.exists) {
    await interaction.editReply("Invalid handle.");
    return null;
  }
  return handleInfo.canonicalHandle ?? handleInput;
};

const replyForInsertResult = (
  interaction: ChatInputCommandInteraction,
  userId: string,
  handle: string,
  result: HandleInsertResult
) => {
  if (result === "ok") {
    return interaction.editReply(`Linked handle for <@${userId}> set to ${handle}.`);
  }
  if (result === "handle_exists") {
    return interaction.editReply("Handle taken in this server.");
  }
  if (result === "already_linked") {
    return interaction.editReply("That user already linked a handle.");
  }
  return interaction.editReply("Unable to link handle right now.");
};

const replyForUpdateResult = (
  interaction: ChatInputCommandInteraction,
  userId: string,
  handle: string,
  result: HandleUpdateResult
) => {
  if (result === "ok") {
    return interaction.editReply(`Updated handle for <@${userId}> to ${handle}.`);
  }
  if (result === "handle_exists") {
    return interaction.editReply("Handle taken in this server.");
  }
  if (result === "not_linked") {
    return interaction.editReply(formatNoHandleMessage(userId));
  }
  return interaction.editReply("Unable to update handle right now.");
};

const getHandleOrReply = async (
  interaction: ChatInputCommandInteraction,
  store: StoreService,
  guildId: string,
  userId: string
): Promise<string | null> => {
  const handle = await store.getHandle(guildId, userId);
  if (!handle) {
    await interaction.editReply(formatNoHandleMessage(userId));
    return null;
  }
  return handle;
};

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
    const guild = await requireGuildEphemeral(
      interaction,
      "This command can only be used in a server."
    );
    if (!guild) {
      return;
    }

    const guildId = guild.id;
    const subcommand = interaction.options.getSubcommand();
    const user = interaction.options.getUser("user", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (subcommand === "status") {
        const handle = await getHandleOrReply(
          interaction,
          context.services.store,
          guildId,
          user.id
        );
        if (!handle) {
          return;
        }
        await interaction.editReply(`Handle for <@${user.id}> is ${handle}.`);
        return;
      }

      if (subcommand === "unlink") {
        const handle = await getHandleOrReply(
          interaction,
          context.services.store,
          guildId,
          user.id
        );
        if (!handle) {
          return;
        }
        await context.services.store.unlinkUser(guildId, user.id);
        await interaction.editReply(`Unlinked handle for <@${user.id}> (${handle}).`);
        return;
      }

      if (subcommand === "set") {
        const resolvedHandle = await resolveCanonicalHandle(interaction, context.services.store);
        if (!resolvedHandle) {
          return;
        }
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
          await replyForUpdateResult(interaction, user.id, resolvedHandle, updateResult);
          return;
        }

        const insertResult = await context.services.store.insertUser(
          guildId,
          user.id,
          resolvedHandle
        );
        await replyForInsertResult(interaction, user.id, resolvedHandle, insertResult);
        return;
      }
    } catch (error) {
      logCommandError(`Handle admin failed: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
