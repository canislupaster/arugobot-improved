import type { ChatInputCommandInteraction } from "discord.js";

import { logError, type LogContext } from "./logger.js";

export function logCommandError(
  message: string,
  interaction: ChatInputCommandInteraction,
  correlationId?: string,
  extra?: LogContext
): void {
  logError(message, {
    correlationId,
    command: interaction.commandName,
    guildId: interaction.guildId ?? undefined,
    userId: interaction.user.id,
    ...extra,
  });
}
