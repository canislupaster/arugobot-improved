import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, version as discordJsVersion } from "discord.js";
import { sql } from "kysely";

import { getDb } from "../db/database.js";
import { getCommandCount } from "../services/metrics.js";
import { getLastError } from "../utils/logger.js";

import type { Command } from "./types.js";

export const healthCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("health")
    .setDescription("Shows diagnostics for this bot instance")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  adminOnly: true,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }
    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();
    const db = getDb();
    let dbOk = false;
    try {
      await sql`select 1`.execute(db);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const lastError = getLastError();

    const embed = new EmbedBuilder()
      .setTitle("ArugoBot Health")
      .setColor(0x3498db)
      .addFields(
        { name: "Uptime", value: `${uptimeSeconds}s`, inline: true },
        { name: "Memory", value: `${Math.round(memory.rss / 1024 / 1024)} MB`, inline: true },
        { name: "DB", value: dbOk ? "OK" : "Failed", inline: true },
        { name: "Commands handled", value: String(getCommandCount()), inline: true },
        { name: "Node", value: process.version, inline: true },
        { name: "discord.js", value: discordJsVersion, inline: true },
        { name: "Bot version", value: process.env.npm_package_version ?? "unknown", inline: true }
      );

    if (lastError) {
      embed.addFields({
        name: "Last error",
        value: `${lastError.timestamp} - ${lastError.message}`,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
