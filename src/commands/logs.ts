import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import type { LogLevel } from "../utils/logger.js";
import { formatDiscordTimestamp } from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 6;

function formatTimestamp(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) {
    return timestamp;
  }
  return formatDiscordTimestamp(Math.floor(ms / 1000));
}

function formatEntryLine(entry: {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: { command?: string; userId?: string };
}): string {
  const parts = [formatTimestamp(entry.timestamp), entry.message];
  if (entry.context?.command) {
    parts.push(`/${entry.context.command}`);
  }
  if (entry.context?.userId) {
    parts.push(`<@${entry.context.userId}>`);
  }
  return `- [${entry.level}] ${parts.join(" • ")}`;
}

export const logsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Shows recent bot logs for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of entries to show (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    )
    .addStringOption((option) =>
      option
        .setName("level")
        .setDescription("Filter by log level")
        .addChoices(
          { name: "Info", value: "info" },
          { name: "Warn", value: "warn" },
          { name: "Error", value: "error" }
        )
    )
    .addStringOption((option) => option.setName("command").setDescription("Filter by command name"))
    .addUserOption((option) => option.setName("user").setDescription("Filter by user")),
  adminOnly: true,
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
    const level = interaction.options.getString("level") as LogLevel | null;
    const command = interaction.options.getString("command")?.trim() ?? "";
    const user = interaction.options.getUser("user");

    await interaction.deferReply({ ephemeral: true });

    try {
      const entries = await context.services.logs.getRecentEntries({
        limit,
        level: level ?? undefined,
        guildId: interaction.guild.id,
        userId: user?.id,
        command: command || undefined,
      });

      if (entries.length === 0) {
        await interaction.editReply("No log entries found for the selected filters.");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Recent logs")
        .setColor(0x3498db)
        .setDescription(entries.map(formatEntryLine).join("\n"));

      const filters: string[] = [];
      if (level) {
        filters.push(`level: ${level}`);
      }
      if (command) {
        filters.push(`command: /${command}`);
      }
      if (user) {
        filters.push(`user: ${user.username}`);
      }
      if (filters.length > 0) {
        embed.setFooter({ text: `Filters • ${filters.join(" • ")}` });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in logs: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
