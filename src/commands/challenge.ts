import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
  type User,
} from "discord.js";

import { logError, type LogContext } from "../utils/logger.js";
import {
  filterProblemsByRatingRange,
  getProblemId,
  selectRandomProblem,
} from "../utils/problemSelection.js";
import { formatTime, getRatingChanges } from "../utils/rating.js";
import { sleep } from "../utils/sleep.js";

import type { Command } from "./types.js";

const VALID_LENGTHS = new Set([40, 60, 80]);
const UPDATE_INTERVAL_SECONDS = 30;
const MIN_RATING = 800;
const MAX_RATING = 3500;

type ContestStatusResponse = Array<{
  verdict?: string;
  creationTimeSeconds: number;
  problem: {
    contestId: number;
    index: string;
  };
}>;

async function gotAc(
  contestId: number,
  problemIndex: string,
  handle: string,
  length: number,
  startTime: number,
  logContext: LogContext,
  request: <T>(endpoint: string, params?: Record<string, string | number | boolean>) => Promise<T>
): Promise<boolean> {
  try {
    const response = await request<ContestStatusResponse>("contest.status", {
      contestId,
      handle,
      from: 1,
      count: 100,
    });
    for (const item of response) {
      const id = `${item.problem.contestId}${item.problem.index}`;
      if (
        id === `${contestId}${problemIndex}` &&
        item.verdict === "OK" &&
        item.creationTimeSeconds <= startTime + length * 60 &&
        item.creationTimeSeconds >= startTime
      ) {
        return true;
      }
    }
    return false;
  } catch (error) {
    logError(`Error during challenge: ${String(error)}`, logContext);
    return false;
  }
}

async function checkAc(
  serverId: string,
  userId: string,
  contestId: number,
  problemIndex: string,
  problemRating: number,
  length: number,
  startTime: number,
  logContext: LogContext,
  context: Parameters<Command["execute"]>[1]
): Promise<number> {
  const handle = await context.services.store.getHandle(serverId, userId);
  if (!handle) {
    return 0;
  }
  if (
    await gotAc(
      contestId,
      problemIndex,
      handle,
      length,
      startTime,
      logContext,
      context.services.codeforces.request.bind(context.services.codeforces)
    )
  ) {
    const rating = await context.services.store.getRating(serverId, userId);
    const [, up] = getRatingChanges(rating, problemRating, length);
    await context.services.store.updateRating(serverId, userId, rating + up);
    return 1;
  }
  return 0;
}

function buildProblemLink(contestId: number, index: string, name: string) {
  return `[${index}. ${name}](https://codeforces.com/problemset/problem/${contestId}/${index})`;
}

function resolveRatingRange(
  rating: number | null,
  minRating: number | null,
  maxRating: number | null
): { minRating: number; maxRating: number; error?: string } {
  if (rating !== null && (minRating !== null || maxRating !== null)) {
    return { minRating: 0, maxRating: 0, error: "Use either rating or min/max, not both." };
  }

  if (rating === null && minRating === null && maxRating === null) {
    return { minRating: 0, maxRating: 0, error: "Provide a problem id or a rating range." };
  }

  const resolvedMin = rating ?? minRating ?? MIN_RATING;
  const resolvedMax = rating ?? maxRating ?? MAX_RATING;

  if (resolvedMin < MIN_RATING || resolvedMax > MAX_RATING) {
    return {
      minRating: 0,
      maxRating: 0,
      error: `Ratings must be between ${MIN_RATING} and ${MAX_RATING}.`,
    };
  }
  if (resolvedMin > resolvedMax) {
    return { minRating: 0, maxRating: 0, error: "Minimum rating cannot exceed maximum rating." };
  }

  return { minRating: resolvedMin, maxRating: resolvedMax };
}

function uniqueUsers(users: User[]): User[] {
  const seen = new Set<string>();
  return users.filter((user) => {
    if (seen.has(user.id)) {
      return false;
    }
    seen.add(user.id);
    return true;
  });
}

export const challengeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("challenge")
    .setDescription("Starts a challenge")
    .addStringOption((option) => option.setName("problem").setDescription("Problem id, e.g. 1000A"))
    .addIntegerOption((option) =>
      option
        .setName("length")
        .setDescription("Challenge length in minutes")
        .setRequired(true)
        .addChoices({ name: "40", value: 40 }, { name: "60", value: 60 }, { name: "80", value: 80 })
    )
    .addIntegerOption((option) =>
      option.setName("rating").setDescription(`Exact problem rating (${MIN_RATING}-${MAX_RATING})`)
    )
    .addIntegerOption((option) =>
      option.setName("min_rating").setDescription(`Minimum rating (${MIN_RATING}-${MAX_RATING})`)
    )
    .addIntegerOption((option) =>
      option.setName("max_rating").setDescription(`Maximum rating (${MIN_RATING}-${MAX_RATING})`)
    )
    .addUserOption((option) => option.setName("user1").setDescription("Participant 1 (optional)"))
    .addUserOption((option) => option.setName("user2").setDescription("Participant 2 (optional)"))
    .addUserOption((option) => option.setName("user3").setDescription("Participant 3 (optional)"))
    .addUserOption((option) => option.setName("user4").setDescription("Participant 4 (optional)")),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }
    const problemIdRaw = interaction.options.getString("problem");
    const rating = interaction.options.getInteger("rating");
    const minRatingOption = interaction.options.getInteger("min_rating");
    const maxRatingOption = interaction.options.getInteger("max_rating");
    const length = interaction.options.getInteger("length", true);

    if (!VALID_LENGTHS.has(length)) {
      await interaction.reply({
        content: "Invalid length. Valid lengths are 40, 60, and 80 minutes.",
        ephemeral: true,
      });
      return;
    }

    if (problemIdRaw && (rating !== null || minRatingOption !== null || maxRatingOption !== null)) {
      await interaction.reply({
        content: "Provide either a problem id or a rating range, not both.",
        ephemeral: true,
      });
      return;
    }

    const range = resolveRatingRange(rating, minRatingOption, maxRatingOption);
    if (!problemIdRaw && range.error) {
      await interaction.reply({ content: range.error, ephemeral: true });
      return;
    }

    const participantUsers = uniqueUsers(
      [
        interaction.user,
        interaction.options.getUser("user1"),
        interaction.options.getUser("user2"),
        interaction.options.getUser("user3"),
        interaction.options.getUser("user4"),
      ].filter(Boolean) as User[]
    );

    if (participantUsers.length > 5) {
      await interaction.reply({ content: "Too many users (limit is 5).", ephemeral: true });
      return;
    }

    for (const user of participantUsers) {
      if (!(await context.services.store.handleLinked(interaction.guild.id, user.id))) {
        await interaction.reply({
          content: "One or more users have not linked a handle.",
          ephemeral: true,
        });
        return;
      }
    }

    const problems = await context.services.problems.ensureProblemsLoaded();
    if (problems.length === 0) {
      await interaction.reply({
        content: "Problem cache not ready yet. Try again in a bit.",
        ephemeral: true,
      });
      return;
    }

    let problemId = "";
    let problem: (typeof problems)[number] | null = null;

    if (problemIdRaw) {
      problemId = problemIdRaw.toUpperCase();
      const problemDict = context.services.problems.getProblemDict();
      problem = problemDict.get(problemId) ?? null;
      if (!problem) {
        await interaction.reply({
          content: "Invalid problem. Make sure it is in the correct format (e.g., 1000A).",
          ephemeral: true,
        });
        return;
      }
    } else {
      const { minRating, maxRating } = range;
      const candidates = filterProblemsByRatingRange(problems, minRating, maxRating);
      if (candidates.length === 0) {
        await interaction.reply({
          content: "No problems found in that rating range.",
          ephemeral: true,
        });
        return;
      }

      const excludedIds = new Set<string>();
      for (const user of participantUsers) {
        const history = await context.services.store.getHistoryList(interaction.guild.id, user.id);
        for (const problemId of history) {
          excludedIds.add(problemId);
        }
      }

      for (const user of participantUsers) {
        const handle = await context.services.store.getHandle(interaction.guild.id, user.id);
        if (!handle) {
          await interaction.reply({
            content: "Missing handle data. Try again in a bit.",
            ephemeral: true,
          });
          return;
        }
        const solved = await context.services.store.getSolvedProblems(handle);
        if (!solved) {
          await interaction.reply({
            content: "Unable to fetch solved problems right now. Try again later.",
            ephemeral: true,
          });
          return;
        }
        for (const solvedId of solved) {
          excludedIds.add(solvedId);
        }
      }

      problem = selectRandomProblem(candidates, excludedIds);
      if (!problem) {
        await interaction.reply({
          content: "No unsolved problems found for this group in that rating range.",
          ephemeral: true,
        });
        return;
      }
      problemId = getProblemId(problem);
    }

    if (!problem) {
      await interaction.reply({
        content: "Problem selection failed. Try again in a moment.",
        ephemeral: true,
      });
      return;
    }

    for (const user of participantUsers) {
      const history = await context.services.store.getHistoryList(interaction.guild.id, user.id);
      if (history.includes(problemId)) {
        await interaction.reply({
          content: "One or more users have already done this problem.",
          ephemeral: true,
        });
        return;
      }
    }

    const confirmEmbed = new EmbedBuilder()
      .setTitle("Confirm challenge")
      .setDescription("All participants must confirm within 30 seconds.")
      .setColor(0x3498db)
      .addFields(
        { name: "Time", value: formatTime(length * 60), inline: false },
        {
          name: "Problem",
          value: buildProblemLink(problem.contestId, problem.index, problem.name),
          inline: false,
        }
      );

    let usersValue = "";
    for (const user of participantUsers) {
      const rating = await context.services.store.getRating(interaction.guild.id, user.id);
      const [down, up] = getRatingChanges(rating, problem.rating!, length);
      usersValue += `- ${user} (${rating}) (don't solve: ${down}, solve: ${up})\n`;
    }
    confirmEmbed.addFields({ name: "Users", value: usersValue, inline: false });

    const confirmId = `challenge_confirm_${interaction.id}`;
    const cancelId = `challenge_cancel_${interaction.id}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel("Confirm").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );

    const response = await interaction.reply({
      embeds: [confirmEmbed],
      components: [row],
      fetchReply: true,
    });

    const confirmed = new Set<string>();
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30000,
    });

    collector.on("collect", async (button) => {
      if (!participantUsers.some((user) => user.id === button.user.id)) {
        await button.reply({ content: "You are not part of this challenge.", ephemeral: true });
        return;
      }

      if (button.customId === cancelId) {
        if (button.user.id !== interaction.user.id) {
          await button.reply({ content: "Only the host can cancel.", ephemeral: true });
          return;
        }
        confirmEmbed.setDescription("Challenge cancelled.");
        await button.update({ embeds: [confirmEmbed], components: [] });
        collector.stop("cancelled");
        return;
      }

      confirmed.add(button.user.id);
      const confirmedValue = participantUsers
        .map((user) =>
          confirmed.has(user.id) ? `- ${user} :white_check_mark:` : `- ${user} :hourglass:`
        )
        .join("\n");
      confirmEmbed.spliceFields(2, 1, { name: "Users", value: confirmedValue, inline: false });
      await button.update({ embeds: [confirmEmbed], components: [row] });

      if (confirmed.size === participantUsers.length) {
        collector.stop("confirmed");
      }
    });

    const status = await new Promise<string>((resolve) => {
      collector.on("end", (_collected, reason) => resolve(reason));
    });

    if (status !== "confirmed") {
      if (status !== "cancelled") {
        confirmEmbed.setDescription("Confirmation failed.");
        await interaction.editReply({ embeds: [confirmEmbed], components: [] });
      }
      return;
    }

    confirmEmbed.setDescription("Challenge confirmed.");
    await interaction.editReply({ embeds: [confirmEmbed], components: [] });

    for (const user of participantUsers) {
      await context.services.store.addToHistory(interaction.guild.id, user.id, problemId);
    }

    const challengeEmbed = new EmbedBuilder()
      .setTitle("Challenge")
      .setColor(0x3498db)
      .addFields(
        { name: "Time", value: formatTime(length * 60), inline: false },
        {
          name: "Problem",
          value: buildProblemLink(problem.contestId, problem.index, problem.name),
          inline: false,
        }
      );

    const solved = participantUsers.map(() => 0);
    const startTime = Math.floor(Date.now() / 1000);
    const baseLogContext: LogContext = {
      correlationId: context.correlationId,
      command: "challenge",
      guildId: interaction.guild.id,
    };

    const challengeMessage = await interaction.followUp({
      embeds: [challengeEmbed],
      fetchReply: true,
    });

    for (let elapsed = 0; elapsed < length * 60; elapsed += UPDATE_INTERVAL_SECONDS) {
      const nextTime = startTime * 1000 + (elapsed + UPDATE_INTERVAL_SECONDS) * 1000;

      const index = Math.floor(elapsed / UPDATE_INTERVAL_SECONDS) % participantUsers.length;
      if (solved[index] === 0) {
        solved[index] = await checkAc(
          interaction.guild.id,
          participantUsers[index].id,
          problem.contestId,
          problem.index,
          problem.rating!,
          length,
          startTime,
          { ...baseLogContext, userId: participantUsers[index].id },
          context
        );
      }

      const loopEmbed = new EmbedBuilder()
        .setTitle("Challenge")
        .setColor(0x3498db)
        .addFields(
          {
            name: "Time",
            value: formatTime(length * 60 - (elapsed + UPDATE_INTERVAL_SECONDS)),
            inline: false,
          },
          {
            name: "Problem",
            value: buildProblemLink(problem.contestId, problem.index, problem.name),
            inline: false,
          }
        );

      let loopUsersValue = "";
      for (let i = 0; i < participantUsers.length; i += 1) {
        const rating = await context.services.store.getRating(
          interaction.guild.id,
          participantUsers[i].id
        );
        const [down, up] = getRatingChanges(rating, problem.rating!, length);
        if (solved[i] === 0) {
          loopUsersValue += `- ${participantUsers[i]} (${rating}) (don't solve: ${down}, solve: ${up}) :hourglass:\n`;
        } else {
          loopUsersValue += `- ${participantUsers[i]} (${rating}) :white_check_mark:\n`;
        }
      }
      loopEmbed.addFields({ name: "Users", value: loopUsersValue, inline: false });

      const waitMs = nextTime - Date.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      await challengeMessage.edit({ embeds: [loopEmbed] });
      if (solved.reduce((sum, value) => sum + value, 0) === participantUsers.length) {
        break;
      }
    }

    for (let i = 0; i < participantUsers.length; i += 1) {
      if (solved[i] === 0) {
        solved[i] = await checkAc(
          interaction.guild.id,
          participantUsers[i].id,
          problem.contestId,
          problem.index,
          problem.rating!,
          length,
          startTime,
          { ...baseLogContext, userId: participantUsers[i].id },
          context
        );
        if (solved[i] === 0) {
          const rating = await context.services.store.getRating(
            interaction.guild.id,
            participantUsers[i].id
          );
          const [down] = getRatingChanges(rating, problem.rating!, length);
          await context.services.store.updateRating(
            interaction.guild.id,
            participantUsers[i].id,
            rating + down
          );
        }
        await sleep(2000);
      }
    }

    const resultEmbed = new EmbedBuilder()
      .setTitle("Challenge results")
      .setColor(0x3498db)
      .addFields({
        name: "Problem",
        value: buildProblemLink(problem.contestId, problem.index, problem.name),
        inline: false,
      });

    let resultUsersValue = "";
    for (let i = 0; i < participantUsers.length; i += 1) {
      const rating = await context.services.store.getRating(
        interaction.guild.id,
        participantUsers[i].id
      );
      if (solved[i] === 0) {
        resultUsersValue += `- ${participantUsers[i]} (${rating}) :x:\n`;
      } else {
        resultUsersValue += `- ${participantUsers[i]} (${rating}) :white_check_mark:\n`;
      }
    }
    resultEmbed.addFields({ name: "Users", value: resultUsersValue, inline: false });
    await challengeMessage.edit({ embeds: [resultEmbed] });
  },
};
