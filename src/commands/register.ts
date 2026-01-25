import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
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

type HandleVerificationResult = "ok" | "verification_failed" | "cancelled" | "error";

type CancelCollector = {
  waitForCancel: Promise<boolean>;
  stop: () => void;
};

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
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setStyle(ButtonStyle.Danger)
      .setLabel(VERIFICATION_CANCEL_LABEL)
  );

  const promptMessage = await interaction.editReply({
    content: `Submit a compilation error to the following problem in the next 60 seconds:\nhttps://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}\nI will confirm as soon as I see it.`,
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
        await button.reply({ content: "Unknown action.", ephemeral: true });
        return;
      }
      if (button.user.id !== userId) {
        await button.reply({ content: "Only the requester can cancel.", ephemeral: true });
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
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }
    const guildId = interaction.guild.id;
    const handle = interaction.options.getString("handle", true);
    const logContext: LogContext = {
      correlationId: context.correlationId,
      command: "register",
      guildId,
      userId: interaction.user.id,
    };

    await interaction.deferReply({ ephemeral: true });

    const handleInfo = await context.services.store.resolveHandle(handle);
    if (!handleInfo.exists) {
      await interaction.editReply("Invalid handle.");
      return;
    }
    const resolvedHandle = handleInfo.canonicalHandle ?? handle;

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

    const verification = await verifyHandleOwnership(
      interaction,
      resolvedHandle,
      context,
      logContext
    );

    if (verification === "ok") {
      const insertResult = await context.services.store.insertUser(
        guildId,
        interaction.user.id,
        resolvedHandle
      );
      if (insertResult === "ok") {
        await interaction.editReply(`Handle set to ${resolvedHandle}.`);
        return;
      }
      if (insertResult === "handle_exists") {
        await interaction.editReply("Handle has been taken.");
        return;
      }
      if (insertResult === "already_linked") {
        await interaction.editReply("You already linked a handle.");
        return;
      }
      await interaction.editReply("Some error (maybe Codeforces is down).");
      return;
    }

    if (verification === "cancelled") {
      return;
    }

    if (verification === "verification_failed") {
      await interaction.editReply("Verification failed.");
      return;
    }

    await interaction.editReply("Some error (maybe Codeforces is down).");
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
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }
    const guildId = interaction.guild.id;
    const newHandle = interaction.options.getString("handle", true);
    const logContext: LogContext = {
      correlationId: context.correlationId,
      command: "relink",
      guildId,
      userId: interaction.user.id,
    };

    const currentHandle = await context.services.store.getHandle(guildId, interaction.user.id);
    if (!currentHandle) {
      await interaction.reply({
        content: "You do not have a linked handle yet. Use /register first.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const handleInfo = await context.services.store.resolveHandle(newHandle);
    if (!handleInfo.exists) {
      await interaction.editReply("Invalid handle.");
      return;
    }
    const resolvedHandle = handleInfo.canonicalHandle ?? newHandle;
    if (currentHandle.toLowerCase() === resolvedHandle.toLowerCase()) {
      await interaction.editReply("That handle is already linked to your account.");
      return;
    }
    if (await context.services.store.handleExists(guildId, resolvedHandle)) {
      await interaction.editReply("Handle taken in this server.");
      return;
    }

    const verification = await verifyHandleOwnership(
      interaction,
      resolvedHandle,
      context,
      logContext
    );
    if (verification === "cancelled") {
      return;
    }
    if (verification !== "ok") {
      await interaction.editReply(
        verification === "verification_failed"
          ? "Verification failed."
          : "Some error (maybe Codeforces is down)."
      );
      return;
    }

    const updateResult = await context.services.store.updateUserHandle(
      guildId,
      interaction.user.id,
      resolvedHandle
    );
    if (updateResult === "ok") {
      await interaction.editReply(`Handle updated to ${resolvedHandle}.`);
      return;
    }
    if (updateResult === "handle_exists") {
      await interaction.editReply("Handle taken in this server.");
      return;
    }
    if (updateResult === "not_linked") {
      await interaction.editReply("You do not have a linked handle yet.");
      return;
    }
    await interaction.editReply("Some error (maybe Codeforces is down).");
  },
};

export const unlinkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Unlinks your Codeforces handle and erases progress"),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }
    const guildId = interaction.guild.id;
    if (!(await context.services.store.handleLinked(guildId, interaction.user.id))) {
      await interaction.reply({ content: "You have not linked a handle.", ephemeral: true });
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
      ephemeral: true,
      fetchReply: true,
    });

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
    });

    collector.on("collect", async (button) => {
      if (button.user.id !== interaction.user.id) {
        await button.reply({ content: "This confirmation isn't for you.", ephemeral: true });
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
