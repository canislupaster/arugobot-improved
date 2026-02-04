import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { replyEphemeral, requireGuildIdEphemeral } from "../utils/interaction.js";
import { formatUpdatedAt } from "../utils/time.js";

import type { Command } from "./types.js";

function buildDashboardUrl(baseUrl: string | undefined, guildId: string): string | null {
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl}/guilds/${guildId}`;
}

function buildDashboardUrlLine(
  baseUrl: string | undefined,
  guildId: string,
  isPublic: boolean
): string {
  if (!isPublic) {
    return "";
  }
  const dashboardUrl = buildDashboardUrl(baseUrl, guildId);
  return dashboardUrl ? ` Dashboard URL: ${dashboardUrl}.` : "";
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
    const guildId = await requireGuildIdEphemeral(
      interaction,
      "This command can only be used in a server."
    );
    if (!guildId) {
      return;
    }
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status") {
        const settings = await context.services.guildSettings.getDashboardSettings(guildId);
        if (!settings) {
          await replyEphemeral(
            interaction,
            "Dashboard visibility is private by default. Use `/dashboard set public:true` to opt in."
          );
          return;
        }
        const urlLine = buildDashboardUrlLine(
          context.config.webPublicUrl,
          guildId,
          settings.isPublic
        );
        const visibility = settings.isPublic ? "public" : "private";
        await replyEphemeral(
          interaction,
          `Dashboard visibility is ${visibility}. Last updated ${formatUpdatedAt(
            settings.updatedAt
          )}.${urlLine}`
        );
        return;
      }

      if (subcommand === "clear") {
        await context.services.guildSettings.clearDashboardSettings(guildId);
        await replyEphemeral(interaction, "Dashboard visibility reset to private.");
        return;
      }

      const isPublic = interaction.options.getBoolean("public", true);
      await context.services.guildSettings.setDashboardPublic(guildId, isPublic);
      const urlLine = buildDashboardUrlLine(context.config.webPublicUrl, guildId, isPublic);
      await replyEphemeral(
        interaction,
        `Dashboard visibility updated: ${isPublic ? "public" : "private"}.${urlLine}`
      );
    } catch (error) {
      logCommandError("Dashboard command failed.", interaction, context.correlationId, {
        error: error instanceof Error ? error.message : String(error),
      });
      await replyEphemeral(interaction, "Failed to update dashboard settings.");
    }
  },
};
