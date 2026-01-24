import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { logError } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

import type { Command } from "./types.js";

const VERIFICATION_TIMEOUT_MS = 60000;

type SubmissionResponse = Array<{
  verdict?: string;
  contestId?: number;
  problem: { index: string; contestId?: number };
  creationTimeSeconds: number;
}>;

type RequestFn = <T>(
  endpoint: string,
  params?: Record<string, string | number | boolean>
) => Promise<T>;

async function gotSubmission(
  contestId: number,
  handle: string,
  index: string,
  startTime: number,
  request: RequestFn
): Promise<boolean> {
  try {
    const result = await request<SubmissionResponse>("contest.status", {
      contestId,
      handle,
      from: 1,
      count: 10,
    });

    for (const submission of result) {
      if (
        submission.problem.index === index &&
        submission.verdict === "COMPILATION_ERROR" &&
        submission.contestId === contestId
      ) {
        return submission.creationTimeSeconds > startTime;
      }
    }
  } catch (error) {
    logError(`Error getting submission: ${String(error)}`);
  }
  return false;
}

async function validateHandle(
  channelReply: (content: string) => Promise<unknown>,
  serverId: string,
  userId: string,
  handle: string,
  context: Parameters<Command["execute"]>[1]
): Promise<"ok" | "handle_exists" | "already_linked" | "verification_failed" | "error"> {
  let problems = context.services.problems.getProblems();
  if (problems.length === 0) {
    try {
      await context.services.problems.refreshProblems(true);
      problems = context.services.problems.getProblems();
    } catch (error) {
      logError(`Failed to get problems: ${String(error)}`);
      return "error";
    }
  }

  if (problems.length === 0) {
    return "error";
  }

  const problem = problems[Math.floor(Math.random() * problems.length)];
  const startTime = Math.floor(Date.now() / 1000);

  await channelReply(
    `Submit a compilation error to the following problem in the next 60 seconds:\nhttps://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`
  );
  await sleep(VERIFICATION_TIMEOUT_MS);

  const hasSubmission = await gotSubmission(
    problem.contestId,
    handle,
    problem.index,
    startTime,
    context.services.codeforces.request.bind(context.services.codeforces)
  );
  if (!hasSubmission) {
    return "verification_failed";
  }

  const insertResult = await context.services.store.insertUser(serverId, userId, handle);
  if (insertResult === "handle_exists") {
    return "handle_exists";
  }
  if (insertResult === "already_linked") {
    return "already_linked";
  }
  if (insertResult === "ok") {
    return "ok";
  }
  return "error";
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
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }
    const guildId = interaction.guild.id;
    const handle = interaction.options.getString("handle", true);

    await interaction.deferReply({ ephemeral: true });

    const existsOnCf = await context.services.store.handleExistsOnCf(handle);
    if (!existsOnCf) {
      await interaction.editReply("Invalid handle.");
      return;
    }

    if (await context.services.store.handleExists(guildId, handle)) {
      await interaction.editReply("Handle taken in this server.");
      return;
    }

    if (await context.services.store.handleLinked(guildId, interaction.user.id)) {
      await interaction.editReply(
        "You already linked a handle (use /unlink if you wish to remove it)."
      );
      return;
    }

    const result = await validateHandle(
      (content) => interaction.editReply(content),
      guildId,
      interaction.user.id,
      handle,
      context
    );

    if (result === "ok") {
      await interaction.editReply(`Handle set to ${handle}.`);
    } else if (result === "verification_failed") {
      await interaction.editReply("Verification failed.");
    } else if (result === "handle_exists") {
      await interaction.editReply("Handle has been taken.");
    } else if (result === "already_linked") {
      await interaction.editReply("You already linked a handle.");
    } else {
      await interaction.editReply("Some error (maybe Codeforces is down).");
    }
  },
};

export const unlinkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Unlinks your Codeforces handle and erases progress"),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
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
      .setColor(0x3498db);

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
