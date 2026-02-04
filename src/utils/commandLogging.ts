import type { ChatInputCommandInteraction } from "discord.js";

import { logError, type LogContext } from "./logger.js";

export function buildCommandLogContext(
  interaction: ChatInputCommandInteraction,
  correlationId?: string,
  guildId?: string
): LogContext {
  return {
    correlationId,
    command: interaction.commandName,
    guildId: guildId ?? interaction.guildId ?? undefined,
    userId: interaction.user.id,
  };
}

export function logCommandError(
  message: string,
  interaction: ChatInputCommandInteraction,
  correlationId?: string,
  extra?: LogContext
): void {
  const baseContext = buildCommandLogContext(
    interaction,
    correlationId,
    extra?.guildId as string | undefined
  );
  logError(message, { ...baseContext, ...extra });
}
