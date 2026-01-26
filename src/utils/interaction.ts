import type {
  ChatInputCommandInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  RepliableInteraction,
  User,
} from "discord.js";
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
  interaction: RepliableInteraction,
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

export async function safeInteractionEdit(
  interaction: RepliableInteraction,
  options: InteractionEditReplyOptions | string,
  context?: LogContext
): Promise<boolean> {
  try {
    await interaction.editReply(options);
    return true;
  } catch (error) {
    if (isIgnorableInteractionError(error)) {
      logWarn("Skipping interaction edit (already acknowledged).", {
        ...context,
        error: getErrorMessage(error) || String(error),
      });
      return false;
    }
    logWarn("Interaction edit failed.", {
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

type HandleUserOptionResult = {
  handleInput: string;
  userOption: User | null;
  member: unknown;
  error?: string;
};

export function resolveHandleUserOptions(
  interaction: ChatInputCommandInteraction,
  options: { handleOptionName?: string; userOptionName?: string } = {}
): HandleUserOptionResult {
  const handleOptionName = options.handleOptionName ?? "handle";
  const userOptionName = options.userOptionName ?? "user";
  const handleInput = interaction.options.getString(handleOptionName)?.trim() ?? "";
  const userOption = interaction.options.getUser(userOptionName);
  const member = interaction.options.getMember(userOptionName);

  if (handleInput && userOption) {
    return {
      handleInput,
      userOption,
      member,
      error: "Provide either a handle or a user, not both.",
    };
  }

  return { handleInput, userOption, member };
}

type IntegerOptionResolver = {
  options: { getInteger: (name: string) => number | null };
};

type BoundedIntegerOptionConfig = {
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  errorMessage?: string;
};

export function resolveBoundedIntegerOption(
  interaction: IntegerOptionResolver,
  config: BoundedIntegerOptionConfig
): { value: number } | { error: string } {
  const value = interaction.options.getInteger(config.name) ?? config.defaultValue;
  if (!Number.isInteger(value) || value < config.min || value > config.max) {
    return { error: config.errorMessage ?? "Invalid value." };
  }
  return { value };
}
