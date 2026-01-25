import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import type { LogLevel } from "../utils/logger.js";
import { formatDiscordTimestamp } from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 6;

type LogCommandFilters = {
  level?: LogLevel;
  command?: string;
  correlationId?: string;
  user?: { id: string; username: string };
};

function normalizeFilterValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatFilterFooter(filters: LogCommandFilters): string | null {
  const items: string[] = [];
  if (filters.level) {
    items.push(`level: ${filters.level}`);
  }
  if (filters.command) {
    items.push(`command: /${filters.command}`);
  }
  if (filters.user) {
    items.push(`user: ${filters.user.username}`);
  }
  if (filters.correlationId) {
    items.push(`correlation: ${filters.correlationId}`);
  }
  return items.length > 0 ? `Filters • ${items.join(" • ")}` : null;
}

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
  context?: { command?: string; userId?: string; latencyMs?: number };
}): string {
  const parts = [formatTimestamp(entry.timestamp), entry.message];
  if (entry.context?.command) {
    parts.push(`/${entry.context.command}`);
  }
  if (entry.context?.userId) {
    parts.push(`<@${entry.context.userId}>`);
  }
  if (Number.isFinite(entry.context?.latencyMs)) {
    parts.push(`${Math.round(entry.context?.latencyMs ?? 0)}ms`);
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
    .addStringOption((option) =>
      option.setName("correlation").setDescription("Filter by correlation id")
    )
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
    const command = normalizeFilterValue(interaction.options.getString("command"));
    const correlationId = normalizeFilterValue(interaction.options.getString("correlation"));
    const user = interaction.options.getUser("user") ?? undefined;
    const filters: LogCommandFilters = {
      level: level ?? undefined,
      command,
      correlationId,
      user: user ? { id: user.id, username: user.username } : undefined,
    };

    await interaction.deferReply({ ephemeral: true });

    try {
      const entries = await context.services.logs.getRecentEntries({
        limit,
        level: filters.level,
        guildId: interaction.guild.id,
        userId: filters.user?.id,
        command: filters.command,
        correlationId: filters.correlationId,
      });

      if (entries.length === 0) {
        await interaction.editReply("No log entries found for the selected filters.");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Recent logs")
        .setColor(EMBED_COLORS.info)
        .setDescription(entries.map(formatEntryLine).join("\n"));

      const footerText = formatFilterFooter(filters);
      if (footerText) {
        embed.setFooter({ text: footerText });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in logs: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
