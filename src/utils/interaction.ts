import type { ChatInputCommandInteraction, InteractionReplyOptions } from "discord.js";
import { DiscordAPIError } from "discord.js";

import type { LogContext } from "./logger.js";
import { logWarn } from "./logger.js";

const IGNORABLE_CODES = new Set([10062, 40060]);

export function isIgnorableInteractionError(error: unknown): boolean {
  if (error instanceof DiscordAPIError) {
    const code = typeof error.code === "number" ? error.code : Number(error.code);
    return Number.isFinite(code) && IGNORABLE_CODES.has(code);
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
  if (!message) {
    return false;
  }
  const lowered = message.toLowerCase();
  return (
    lowered.includes("unknown interaction") ||
    lowered.includes("interaction has already been acknowledged")
  );
}

export async function safeInteractionReply(
  interaction: ChatInputCommandInteraction,
  options: InteractionReplyOptions,
  context?: LogContext
): Promise<boolean> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(options);
    } else {
      await interaction.reply(options);
    }
    return true;
  } catch (error) {
    if (isIgnorableInteractionError(error)) {
      logWarn("Skipping interaction response (already acknowledged).", {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    logWarn("Interaction response failed.", {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
