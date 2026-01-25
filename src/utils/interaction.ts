import type { ChatInputCommandInteraction, InteractionReplyOptions, User } from "discord.js";
import { DiscordAPIError } from "discord.js";

import { getErrorMessage } from "./errors.js";
import type { LogContext } from "./logger.js";
import { logWarn } from "./logger.js";

const IGNORABLE_CODES = new Set([10062, 40060]);

export function isIgnorableInteractionError(error: unknown): boolean {
  if (error instanceof DiscordAPIError) {
    const code = typeof error.code === "number" ? error.code : Number(error.code);
    return Number.isFinite(code) && IGNORABLE_CODES.has(code);
  }
  const message = getErrorMessage(error);
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
        error: getErrorMessage(error) || String(error),
      });
      return false;
    }
    logWarn("Interaction response failed.", {
      ...context,
      error: getErrorMessage(error) || String(error),
    });
    return false;
  }
}

type DisplayNameMember = {
  displayName?: string;
  toString?: () => string;
};

export function resolveTargetLabels(user: User, member: unknown) {
  const displayName =
    member && typeof member === "object" && "displayName" in member
      ? (member as DisplayNameMember).displayName ?? user.username
      : user.username;
  const memberToString =
    member && typeof member === "object" && "toString" in member
      ? (member as DisplayNameMember).toString
      : undefined;
  const mention =
    typeof memberToString === "function" && memberToString !== Object.prototype.toString
      ? memberToString.call(member)
      : user.toString();
  return { displayName, mention };
}
