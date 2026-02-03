import type {
  ChatInputCommandInteraction,
  InteractionDeferReplyOptions,
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
  return safeInteractionAction(
    () =>
      interaction.deferred || interaction.replied
        ? interaction.followUp(options)
        : interaction.reply(options),
    {
      skipMessage: "Skipping interaction response (already acknowledged).",
      errorMessage: "Interaction response failed.",
    },
    context
  );
}

export async function safeInteractionEdit(
  interaction: RepliableInteraction,
  options: InteractionEditReplyOptions | string,
  context?: LogContext
): Promise<boolean> {
  return safeInteractionAction(
    () => interaction.editReply(options),
    {
      skipMessage: "Skipping interaction edit (already acknowledged).",
      errorMessage: "Interaction edit failed.",
    },
    context
  );
}

export async function safeInteractionDefer(
  interaction: RepliableInteraction,
  options?: InteractionDeferReplyOptions,
  context?: LogContext
): Promise<boolean> {
  if (interaction.deferred || interaction.replied) {
    return true;
  }
  return safeInteractionAction(
    () => interaction.deferReply(options),
    {
      skipMessage: "Skipping interaction defer (already acknowledged).",
      errorMessage: "Interaction defer failed.",
    },
    context
  );
}

export async function requireGuild(
  interaction: ChatInputCommandInteraction,
  options: InteractionReplyOptions
): Promise<NonNullable<ChatInputCommandInteraction["guild"]> | null> {
  if (interaction.guild) {
    return interaction.guild;
  }
  await interaction.reply(options);
  return null;
}

async function safeInteractionAction(
  action: () => Promise<unknown>,
  labels: { skipMessage: string; errorMessage: string },
  context?: LogContext
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    const errorMessage = getErrorMessage(error) || String(error);
    if (isIgnorableInteractionError(error)) {
      logWarn(labels.skipMessage, { ...context, error: errorMessage });
      return false;
    }
    logWarn(labels.errorMessage, { ...context, error: errorMessage });
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

type HandleTargetContextMessages = {
  userInDm?: string;
  missingHandleInDm?: string;
};

export function validateHandleTargetContext(
  interaction: ChatInputCommandInteraction,
  handleInput: string,
  userOption: User | null,
  messages: HandleTargetContextMessages = {}
): string | null {
  if (!interaction.guild && userOption) {
    return messages.userInDm ?? "This command can only target other users in a server.";
  }
  if (!interaction.guild && !handleInput) {
    return messages.missingHandleInDm ?? "Provide a handle when using this command in DMs.";
  }
  return null;
}

type HandleTargetLabelsResult =
  | { status: "error"; error: string }
  | {
      status: "ok";
      handleInput: string;
      userOption: User | null;
      member: unknown;
      user: User;
      targetId: string;
      labels: { displayName: string; mention: string };
    };

export function resolveHandleTargetLabels(
  interaction: ChatInputCommandInteraction,
  options: {
    handleOptionName?: string;
    userOptionName?: string;
    contextMessages?: HandleTargetContextMessages;
  } = {}
): HandleTargetLabelsResult {
  const handleResolution = resolveHandleUserOptions(interaction, {
    handleOptionName: options.handleOptionName,
    userOptionName: options.userOptionName,
  });
  if (handleResolution.error) {
    return { status: "error", error: handleResolution.error };
  }
  const { handleInput, userOption, member } = handleResolution;
  const contextError = validateHandleTargetContext(
    interaction,
    handleInput,
    userOption,
    options.contextMessages ?? {}
  );
  if (contextError) {
    return { status: "error", error: contextError };
  }
  const user = userOption ?? interaction.user;
  const labels = resolveTargetLabels(user, member);
  return {
    status: "ok",
    handleInput,
    userOption,
    member,
    user,
    targetId: user.id,
    labels,
  };
}

export type HandleTargetLabelsReplyResult =
  | { status: "replied" }
  | Extract<HandleTargetLabelsResult, { status: "ok" }>;

export async function resolveHandleTargetLabelsOrReply(
  interaction: ChatInputCommandInteraction,
  options: {
    handleOptionName?: string;
    userOptionName?: string;
    contextMessages?: HandleTargetContextMessages;
  } = {}
): Promise<HandleTargetLabelsReplyResult> {
  const result = resolveHandleTargetLabels(interaction, options);
  if (result.status === "error") {
    await safeInteractionReply(interaction, { content: result.error });
    return { status: "replied" };
  }
  return result;
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

export function resolvePageOption(
  interaction: IntegerOptionResolver,
  options: { defaultValue?: number; max?: number; errorMessage?: string } = {}
): { value: number } | { error: string } {
  return resolveBoundedIntegerOption(interaction, {
    name: "page",
    min: 1,
    max: options.max ?? Number.MAX_SAFE_INTEGER,
    defaultValue: options.defaultValue ?? 1,
    errorMessage: options.errorMessage ?? "Invalid page.",
  });
}
