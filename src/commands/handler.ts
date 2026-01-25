import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";

import type { CommandContext } from "../types/commandContext.js";
import type { CooldownManager } from "../utils/cooldown.js";
import { safeInteractionReply } from "../utils/interaction.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";

import type { Command } from "./types.js";

function buildLogContext(
  interaction: ChatInputCommandInteraction,
  correlationId: string,
  latencyMs: number
) {
  return {
    correlationId,
    command: interaction.commandName,
    guildId: interaction.guildId ?? undefined,
    userId: interaction.user.id,
    latencyMs,
  };
}

async function sendErrorResponse(
  interaction: ChatInputCommandInteraction,
  correlationId: string,
  latencyMs: number
): Promise<void> {
  await safeInteractionReply(
    interaction,
    { content: "Something went wrong." },
    buildLogContext(interaction, correlationId, latencyMs)
  );
}

export async function handleCommandInteraction(
  interaction: ChatInputCommandInteraction,
  commands: Map<string, Command>,
  context: CommandContext,
  cooldowns: CooldownManager,
  correlationId: string
): Promise<void> {
  const startTime = Date.now();
  const getLatencyMs = () => Date.now() - startTime;
  const command = commands.get(interaction.commandName);
  if (!command) {
    logWarn("Unknown command.", buildLogContext(interaction, correlationId, getLatencyMs()));
    await safeInteractionReply(
      interaction,
      { content: "Unknown command." },
      buildLogContext(interaction, correlationId, getLatencyMs())
    );
    return;
  }

  if (command.adminOnly && interaction.inGuild()) {
    const memberPermissions = interaction.memberPermissions;
    if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      logWarn(
        "Command blocked (permissions).",
        buildLogContext(interaction, correlationId, getLatencyMs())
      );
      await safeInteractionReply(
        interaction,
        { content: "You do not have permission to use this command." },
        buildLogContext(interaction, correlationId, getLatencyMs())
      );
      return;
    }
  }

  const cooldown = cooldowns.isAllowed(interaction.user.id);
  if (!cooldown.allowed) {
    logWarn("Command blocked (cooldown).", {
      ...buildLogContext(interaction, correlationId, getLatencyMs()),
      retryAfterSeconds: cooldown.retryAfterSeconds,
    });
    await safeInteractionReply(
      interaction,
      { content: `Too many requests. Try again in ${cooldown.retryAfterSeconds}s.` },
      buildLogContext(interaction, correlationId, getLatencyMs())
    );
    return;
  }

  logInfo("Command received.", buildLogContext(interaction, correlationId, getLatencyMs()));

  let success = false;
  try {
    await command.execute(interaction, context);
    success = true;
    logInfo("Command completed.", buildLogContext(interaction, correlationId, getLatencyMs()));
  } catch (error) {
    logError("Command failed.", {
      ...buildLogContext(interaction, correlationId, getLatencyMs()),
      error: error instanceof Error ? error.message : String(error),
    });
    await sendErrorResponse(interaction, correlationId, getLatencyMs());
  } finally {
    await context.services.metrics.recordCommandResult(
      interaction.commandName,
      getLatencyMs(),
      success
    );
  }
}
