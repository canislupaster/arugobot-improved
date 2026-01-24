import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { ephemeralFlags } from "../utils/discordFlags.js";

import type { Command } from "./types.js";

type RefreshScope = "all" | "contests" | "handles" | "problems";

function resolveScope(raw: string | null): RefreshScope {
  if (raw === "contests" || raw === "handles" || raw === "problems") {
    return raw;
  }
  return "all";
}

export const refreshCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Refresh cached Codeforces data for this bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("What to refresh")
        .addChoices(
          { name: "All", value: "all" },
          { name: "Problems", value: "problems" },
          { name: "Contests", value: "contests" },
          { name: "Handles", value: "handles" }
        )
    ),
  adminOnly: true,
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ...ephemeralFlags,
      });
      return;
    }

    const scope = resolveScope(interaction.options.getString("scope"));
    await interaction.deferReply({ ...ephemeralFlags });

    const embed = new EmbedBuilder().setTitle("Refresh results").setColor(0x3498db);
    const errors: string[] = [];
    const refreshAll = scope === "all";

    if (refreshAll || scope === "problems") {
      try {
        await context.services.problems.refreshProblems(true);
        const count = context.services.problems.getProblems().length;
        embed.addFields({ name: "Problems", value: `${count} cached`, inline: true });
      } catch (error) {
        errors.push("Problem cache refresh failed.");
        logCommandError(
          `Problem refresh failed: ${String(error)}`,
          interaction,
          context.correlationId
        );
      }
    }

    if (refreshAll || scope === "contests") {
      try {
        await context.services.contests.refresh(true);
        const upcoming = context.services.contests.getUpcomingContests().length;
        const ongoing = context.services.contests.getOngoing().length;
        embed.addFields({
          name: "Contests",
          value: `${upcoming} upcoming, ${ongoing} ongoing`,
          inline: true,
        });
      } catch (error) {
        errors.push("Contest cache refresh failed.");
        logCommandError(
          `Contest refresh failed: ${String(error)}`,
          interaction,
          context.correlationId
        );
      }
    }

    if (refreshAll || scope === "handles") {
      try {
        const summary = await context.services.store.refreshHandles();
        embed.addFields({
          name: "Handles",
          value: `${summary.updated} updated (${summary.checked} checked)`,
          inline: true,
        });
      } catch (error) {
        errors.push("Handle refresh failed.");
        logCommandError(
          `Handle refresh failed: ${String(error)}`,
          interaction,
          context.correlationId
        );
      }
    }

    if (errors.length > 0) {
      embed.addFields({ name: "Errors", value: errors.join("\n"), inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
