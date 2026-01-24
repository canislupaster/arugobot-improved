import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";

import { incrementCommandCount } from "../services/metrics.js";
import type { CommandContext } from "../types/commandContext.js";
import type { CooldownManager } from "../utils/cooldown.js";
import { logError, logInfo } from "../utils/logger.js";

import type { Command } from "./types.js";

export async function handleCommandInteraction(
  interaction: ChatInputCommandInteraction,
  commands: Map<string, Command>,
  context: CommandContext,
  cooldowns: CooldownManager,
  correlationId: string
): Promise<void> {
  const command = commands.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ content: "Unknown command.", ephemeral: true });
    return;
  }

  if (command.adminOnly && interaction.inGuild()) {
    const memberPermissions = interaction.memberPermissions;
    if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
      return;
    }
  }

  const cooldown = cooldowns.isAllowed(interaction.user.id);
  if (!cooldown.allowed) {
    await interaction.reply({
      content: `Too many requests. Try again in ${cooldown.retryAfterSeconds}s.`,
      ephemeral: true,
    });
    return;
  }

  const startTime = Date.now();
  incrementCommandCount();
  logInfo("Command received.", {
    correlationId,
    command: interaction.commandName,
    guildId: interaction.guildId ?? undefined,
    userId: interaction.user.id,
  });

  try {
    await command.execute(interaction, context);
    logInfo("Command completed.", {
      correlationId,
      command: interaction.commandName,
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    logError("Command failed.", {
      correlationId,
      command: interaction.commandName,
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    });
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
    } else {
      await interaction.reply({ content: "Something went wrong.", ephemeral: true });
    }
  }
}
