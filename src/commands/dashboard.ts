import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { formatDiscordTimestamp } from "../utils/time.js";

import type { Command } from "./types.js";

function formatUpdatedAt(updatedAt: string): string {
  const parsed = Date.parse(updatedAt);
  if (!Number.isFinite(parsed)) {
    return updatedAt;
  }
  return formatDiscordTimestamp(Math.floor(parsed / 1000));
}

export const dashboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Configure web dashboard visibility for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set whether this server is visible on the web dashboard")
        .addBooleanOption((option) =>
          option
            .setName("public")
            .setDescription("Allow this server to appear on the public dashboard")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show the current dashboard visibility")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Reset to private (not shown on the dashboard)")
    ),
  adminOnly: true,
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status") {
        const settings = await context.services.guildSettings.getDashboardSettings(guildId);
        if (!settings) {
          await interaction.reply({
            content:
              "Dashboard visibility is private by default. Use `/dashboard set public:true` to opt in.",
            ephemeral: true,
          });
          return;
        }
        await interaction.reply({
          content: `Dashboard visibility is ${settings.isPublic ? "public" : "private"}. Last updated ${formatUpdatedAt(
            settings.updatedAt
          )}.`,
          ephemeral: true,
        });
        return;
      }

      if (subcommand === "clear") {
        await context.services.guildSettings.clearDashboardSettings(guildId);
        await interaction.reply({
          content: "Dashboard visibility reset to private.",
          ephemeral: true,
        });
        return;
      }

      const isPublic = interaction.options.getBoolean("public", true);
      await context.services.guildSettings.setDashboardPublic(guildId, isPublic);
      await interaction.reply({
        content: `Dashboard visibility updated: ${isPublic ? "public" : "private"}.`,
        ephemeral: true,
      });
    } catch (error) {
      logCommandError("Dashboard command failed.", interaction, context.correlationId, {
        error: error instanceof Error ? error.message : String(error),
      });
      await interaction.reply({
        content: "Failed to update dashboard settings.",
        ephemeral: true,
      });
    }
  },
};
