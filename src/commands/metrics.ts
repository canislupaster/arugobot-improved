import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import type { CommandMetricSummary } from "../services/metrics.js";
import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { resolveBoundedIntegerOption } from "../utils/interaction.js";
import { normalizeOptionalString } from "../utils/text.js";
import { formatUpdatedAt } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

function formatSummaryLine(summary: CommandMetricSummary): string {
  return `/${summary.name}: ${summary.count} (ok ${summary.successRate}%, avg ${summary.avgLatencyMs}ms, max ${summary.maxLatencyMs}ms, last ${formatUpdatedAt(summary.lastSeenAt)})`;
}

export const metricsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("metrics")
    .setDescription("Shows command usage metrics")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("command")
        .setDescription("Show stats for a single command (e.g. ping)")
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of commands to show (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    ),
  adminOnly: true,
  async execute(interaction, context) {
    const commandNameRaw =
      normalizeOptionalString(interaction.options.getString("command")) ?? "";
    const commandName = commandNameRaw.replace(/^\/+/, "");
    const limitResult = resolveBoundedIntegerOption(interaction, {
      name: "limit",
      min: 1,
      max: MAX_LIMIT,
      defaultValue: DEFAULT_LIMIT,
      errorMessage: "Invalid limit.",
    });
    if ("error" in limitResult) {
      await interaction.reply({ content: limitResult.error, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (commandName) {
        const summary = await context.services.metrics.getCommandSummary(commandName);
        if (!summary) {
          await interaction.editReply(`No metrics found for /${commandName}.`);
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(`Command metrics: /${summary.name}`)
          .setColor(EMBED_COLORS.info)
          .addFields([
            { name: "Count", value: String(summary.count), inline: true },
            { name: "Success rate", value: `${summary.successRate}%`, inline: true },
            { name: "Average latency", value: `${summary.avgLatencyMs}ms`, inline: true },
            { name: "Max latency", value: `${summary.maxLatencyMs}ms`, inline: true },
            { name: "Last seen", value: formatUpdatedAt(summary.lastSeenAt), inline: false },
          ]);

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const summaries = await context.services.metrics.getCommandUsageSummary(limitResult.value);
      if (summaries.length === 0) {
        await interaction.editReply("No command metrics recorded yet.");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Command metrics")
        .setColor(EMBED_COLORS.info)
        .setDescription(summaries.map(formatSummaryLine).join("\n"));

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Metrics command failed: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
