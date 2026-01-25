import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";

import { waitForCompilationError } from "../services/verification.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { logError, type LogContext } from "../utils/logger.js";

import type { Command } from "./types.js";

const VERIFICATION_TIMEOUT_MS = 60000;
const VERIFICATION_POLL_MS = 5000;
const VERIFICATION_CANCEL_LABEL = "Cancel verification";
const GENERIC_ERROR_MESSAGE = "Some error (maybe Codeforces is down).";

type HandleVerificationResult = "ok" | "verification_failed" | "cancelled" | "error";

type CancelCollector = {
  waitForCancel: Promise<boolean>;
  stop: () => void;
};

type ResolvedHandle =
  | {
      status: "ok";
      handle: string;
    }
  | {
      status: "invalid";
    };

type InsertResult = "ok" | "handle_exists" | "already_linked" | "error";
type UpdateResult = "ok" | "handle_exists" | "not_linked" | "error";

async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function replyButtonEphemeral(button: ButtonInteraction, content: string): Promise<void> {
  await button.reply({ content, flags: MessageFlags.Ephemeral });
}

async function requireGuild(
  interaction: ChatInputCommandInteraction
): Promise<{ guildId: string } | null> {
  if (!interaction.guild) {
    await replyEphemeral(interaction, "This command can only be used in a server.");
    return null;
  }
  return { guildId: interaction.guild.id };
}

async function resolveCanonicalHandle(
  handle: string,
  context: Parameters<Command["execute"]>[1]
): Promise<ResolvedHandle> {
  const handleInfo = await context.services.store.resolveHandle(handle);
  if (!handleInfo.exists) {
    return { status: "invalid" };
  }
  return { status: "ok", handle: handleInfo.canonicalHandle ?? handle };
}

async function resolveHandleOrReply(
  interaction: ChatInputCommandInteraction,
  handle: string,
  context: Parameters<Command["execute"]>[1]
): Promise<string | null> {
  const resolved = await resolveCanonicalHandle(handle, context);
  if (resolved.status === "invalid") {
    await interaction.editReply("Invalid handle.");
    return null;
  }
  return resolved.handle;
}

function getVerificationFailureMessage(result: HandleVerificationResult): string | null {
  if (result === "verification_failed") {
    return "Verification failed.";
  }
  if (result === "error") {
    return GENERIC_ERROR_MESSAGE;
  }
  return null;
}

function getInsertResultMessage(result: InsertResult, handle: string): string {
  if (result === "ok") {
    return `Handle set to ${handle}.`;
  }
  if (result === "handle_exists") {
    return "Handle has been taken.";
  }
  if (result === "already_linked") {
    return "You already linked a handle.";
  }
  return GENERIC_ERROR_MESSAGE;
}

function getUpdateResultMessage(result: UpdateResult, handle: string): string {
  if (result === "ok") {
    return `Handle updated to ${handle}.`;
  }
  if (result === "handle_exists") {
    return "Handle taken in this server.";
  }
  if (result === "not_linked") {
    return "You do not have a linked handle yet.";
  }
  return GENERIC_ERROR_MESSAGE;
}

async function runVerificationAndReport(
  interaction: ChatInputCommandInteraction,
  handle: string,
  context: Parameters<Command["execute"]>[1],
  logContext: LogContext
): Promise<"ok" | "cancelled" | "failed"> {
  const verification = await verifyHandleOwnership(interaction, handle, context, logContext);
  if (verification === "cancelled") {
    return "cancelled";
  }
  if (verification !== "ok") {
    const failureMessage = getVerificationFailureMessage(verification);
    if (failureMessage) {
      await interaction.editReply(failureMessage);
    }
    return "failed";
  }
  return "ok";
}

function createLogContext(
  command: string,
  guildId: string,
  userId: string,
  correlationId: string
): LogContext {
  return {
    correlationId,
    command,
    guildId,
    userId,
  };
}

async function verifyHandleOwnership(
  interaction: ChatInputCommandInteraction,
  handle: string,
  context: Parameters<Command["execute"]>[1],
  logContext: LogContext
): Promise<HandleVerificationResult> {
  let problems: Awaited<ReturnType<typeof context.services.problems.ensureProblemsLoaded>>;
  try {
    problems = await context.services.problems.ensureProblemsLoaded();
  } catch (error) {
    logError(`Failed to get problems: ${String(error)}`, logContext);
    return "error";
  }

  if (problems.length === 0) {
    return "error";
  }

  const problem = problems[Math.floor(Math.random() * problems.length)];
  const startTime = Math.floor(Date.now() / 1000);
  const abortController = new AbortController();
  const cancelId = `cancel_verification:${context.correlationId}`;
  const timeoutSeconds = Math.floor(VERIFICATION_TIMEOUT_MS / 1000);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setStyle(ButtonStyle.Danger)
      .setLabel(VERIFICATION_CANCEL_LABEL)
  );

  const promptMessage = await interaction.editReply({
    content: `Submit a compilation error to the following problem in the next ${timeoutSeconds} seconds:\nhttps://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}\nI will confirm as soon as I see it.`,
    components: [row],
  });

  const cancelCollector = hasComponentCollector(promptMessage)
    ? createCancelCollector(promptMessage, interaction.user.id, cancelId, abortController)
    : {
        waitForCancel: Promise.resolve(false),
        stop: () => {},
      };

  const verified = await waitForCompilationError({
    contestId: problem.contestId,
    handle,
    index: problem.index,
    startTimeSeconds: startTime,
    timeoutMs: VERIFICATION_TIMEOUT_MS,
    pollIntervalMs: VERIFICATION_POLL_MS,
    logContext,
    request: context.services.codeforces.request.bind(context.services.codeforces),
    signal: abortController.signal,
  });
  cancelCollector.stop();
  const cancelled = await cancelCollector.waitForCancel;
  if (cancelled) {
    return "cancelled";
  }
  if (!verified) {
    return "verification_failed";
  }

  return "ok";
}

function hasComponentCollector(message: unknown): message is Message {
  return (
    typeof message === "object" &&
    message !== null &&
    "createMessageComponentCollector" in message &&
    typeof (message as Message).createMessageComponentCollector === "function"
  );
}

function createCancelCollector(
  message: Message,
  userId: string,
  customId: string,
  abortController: AbortController
): CancelCollector {
  let resolved = false;
  let stop = () => {};
  const waitForCancel = new Promise<boolean>((resolve) => {
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: VERIFICATION_TIMEOUT_MS,
    });
    stop = () => collector.stop("finished");
    const finish = (result: boolean) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(result);
    };

    collector.on("collect", async (button) => {
      if (button.customId !== customId) {
        await replyButtonEphemeral(button, "Unknown action.");
        return;
      }
      if (button.user.id !== userId) {
        await replyButtonEphemeral(button, "Only the requester can cancel.");
        return;
      }
      abortController.abort();
      await button.update({ content: "Verification canceled.", components: [] });
      finish(true);
      collector.stop("cancelled");
    });

    collector.on("end", () => finish(false));
  });

  return { waitForCancel, stop };
}

export const registerCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("register")
    .setDescription("Links your Codeforces handle")
    .addStringOption((option) =>
      option.setName("handle").setDescription("Your Codeforces handle").setRequired(true)
    ),
  async execute(interaction, context) {
    const guild = await requireGuild(interaction);
    if (!guild) {
      return;
    }
    const { guildId } = guild;
    const handle = interaction.options.getString("handle", true);
    const logContext = createLogContext(
      "register",
      guildId,
      interaction.user.id,
      context.correlationId
    );

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const resolvedHandle = await resolveHandleOrReply(interaction, handle, context);
    if (!resolvedHandle) {
      return;
    }

    if (await context.services.store.handleExists(guildId, resolvedHandle)) {
      await interaction.editReply("Handle taken in this server.");
      return;
    }

    if (await context.services.store.handleLinked(guildId, interaction.user.id)) {
      await interaction.editReply(
        "You already linked a handle (use /unlink if you wish to remove it)."
      );
      return;
    }

    const verificationResult = await runVerificationAndReport(
      interaction,
      resolvedHandle,
      context,
      logContext
    );
    if (verificationResult !== "ok") {
      return;
    }

    const insertResult = await context.services.store.insertUser(
      guildId,
      interaction.user.id,
      resolvedHandle
    );
    await interaction.editReply(getInsertResultMessage(insertResult, resolvedHandle));
  },
};

export const relinkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("relink")
    .setDescription("Updates your linked Codeforces handle")
    .addStringOption((option) =>
      option.setName("handle").setDescription("New Codeforces handle").setRequired(true)
    ),
  async execute(interaction, context) {
    const guild = await requireGuild(interaction);
    if (!guild) {
      return;
    }
    const { guildId } = guild;
    const newHandle = interaction.options.getString("handle", true);
    const logContext = createLogContext(
      "relink",
      guildId,
      interaction.user.id,
      context.correlationId
    );

    const currentHandle = await context.services.store.getHandle(guildId, interaction.user.id);
    if (!currentHandle) {
      await replyEphemeral(
        interaction,
        "You do not have a linked handle yet. Use /register first."
      );
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const resolvedHandle = await resolveHandleOrReply(interaction, newHandle, context);
    if (!resolvedHandle) {
      return;
    }
    if (currentHandle.toLowerCase() === resolvedHandle.toLowerCase()) {
      await interaction.editReply("That handle is already linked to your account.");
      return;
    }
    if (await context.services.store.handleExists(guildId, resolvedHandle)) {
      await interaction.editReply("Handle taken in this server.");
      return;
    }

    const verificationResult = await runVerificationAndReport(
      interaction,
      resolvedHandle,
      context,
      logContext
    );
    if (verificationResult !== "ok") {
      return;
    }

    const updateResult = await context.services.store.updateUserHandle(
      guildId,
      interaction.user.id,
      resolvedHandle
    );
    await interaction.editReply(getUpdateResultMessage(updateResult, resolvedHandle));
  },
};

export const unlinkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Unlinks your Codeforces handle and erases progress"),
  async execute(interaction, context) {
    const guild = await requireGuild(interaction);
    if (!guild) {
      return;
    }
    const { guildId } = guild;
    if (!(await context.services.store.handleLinked(guildId, interaction.user.id))) {
      await replyEphemeral(interaction, "You have not linked a handle.");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Confirm unlink")
      .setDescription("Are you sure? This action cannot be undone.")
      .setColor(EMBED_COLORS.info);

    const confirmId = `unlink_confirm_${interaction.user.id}`;
    const cancelId = `unlink_cancel_${interaction.user.id}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel("Confirm").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );

    const response = await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
      fetchReply: true,
    });

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
    });

    collector.on("collect", async (button) => {
      if (button.user.id !== interaction.user.id) {
        await replyButtonEphemeral(button, "This confirmation isn't for you.");
        return;
      }

      if (button.customId === confirmId) {
        await context.services.store.unlinkUser(guildId, interaction.user.id);
        embed.setDescription("Account unlinked.");
        await button.update({ embeds: [embed], components: [] });
      } else {
        embed.setDescription("Account not unlinked.");
        await button.update({ embeds: [embed], components: [] });
      }
      collector.stop("handled");
    });

    collector.on("end", async (_collected, reason) => {
      if (reason === "handled") {
        return;
      }
      embed.setDescription("No response received. Account not unlinked.");
      await interaction.editReply({ embeds: [embed], components: [] });
    });
  },
};
