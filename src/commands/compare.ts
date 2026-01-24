import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_TARGETS = 5;

function parseHandleList(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

export const compareCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("compare")
    .setDescription("Compare Codeforces stats for users or handles")
    .addUserOption((option) => option.setName("user1").setDescription("User to compare"))
    .addUserOption((option) => option.setName("user2").setDescription("Another user to compare"))
    .addUserOption((option) => option.setName("user3").setDescription("Another user to compare"))
    .addUserOption((option) => option.setName("user4").setDescription("Another user to compare"))
    .addStringOption((option) =>
      option
        .setName("handles")
        .setDescription("Comma or space separated handles to compare")
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const userOptions = [
      interaction.options.getUser("user1"),
      interaction.options.getUser("user2"),
      interaction.options.getUser("user3"),
      interaction.options.getUser("user4"),
    ].filter(Boolean);

    const handlesRaw = interaction.options.getString("handles")?.trim() ?? "";
    const handleInputs = parseHandleList(handlesRaw);

    if (userOptions.length === 0 && handleInputs.length === 0) {
      userOptions.push(interaction.user);
    }

    if (userOptions.length + handleInputs.length > MAX_TARGETS) {
      await interaction.reply({
        content: `Too many targets. Limit is ${MAX_TARGETS}.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const targets: Array<{
        label: string;
        handle: string;
        botRating: number | null;
      }> = [];
      const seenHandles = new Set<string>();

      for (const user of userOptions) {
        const handle = await context.services.store.getHandle(interaction.guild.id, user!.id);
        if (!handle) {
          await interaction.editReply(
            `User <@${user!.id}> does not have a linked handle.`
          );
          return;
        }
        const normalized = handle.toLowerCase();
        if (seenHandles.has(normalized)) {
          continue;
        }
        seenHandles.add(normalized);
        const rating = await context.services.store.getRating(interaction.guild.id, user!.id);
        targets.push({
          label: `<@${user!.id}>`,
          handle,
          botRating: Number.isFinite(rating) && rating >= 0 ? rating : null,
        });
      }

      for (const handleInput of handleInputs) {
        const resolved = await context.services.store.resolveHandle(handleInput);
        if (!resolved.exists) {
          await interaction.editReply(`Invalid handle: ${handleInput}`);
          return;
        }
        const handle = resolved.canonicalHandle ?? handleInput;
        const normalized = handle.toLowerCase();
        if (seenHandles.has(normalized)) {
          continue;
        }
        seenHandles.add(normalized);
        targets.push({ label: handle, handle, botRating: null });
      }

      if (targets.length === 0) {
        await interaction.editReply("No valid handles found to compare.");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Codeforces comparison")
        .setColor(0x3498db);

      let stale = false;
      for (const target of targets) {
        const profile = await context.services.store.getCodeforcesProfile(target.handle);
        if (profile?.isStale) {
          stale = true;
        }
        const cfRating =
          profile?.profile.rating !== null && profile?.profile.rating !== undefined
            ? `${profile.profile.rating} (${profile.profile.rank ?? "unrated"})`
            : "Unrated";
        const cfMax =
          profile?.profile.maxRating !== null && profile?.profile.maxRating !== undefined
            ? `${profile.profile.maxRating} (${profile.profile.maxRank ?? "unknown"})`
            : "N/A";
        const cfLastOnline = profile?.profile.lastOnlineTimeSeconds
          ? formatDiscordRelativeTime(profile.profile.lastOnlineTimeSeconds)
          : "Unknown";
        const botRating = target.botRating ?? "N/A";

        embed.addFields({
          name: target.label,
          value: [
            `Handle: ${target.handle}`,
            `Bot rating: ${botRating}`,
            `CF rating: ${cfRating}`,
            `CF max: ${cfMax}`,
            `Last online: ${cfLastOnline}`,
          ].join("\n"),
          inline: false,
        });
      }

      if (stale) {
        embed.setFooter({ text: "Some Codeforces data may be stale." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in compare: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
