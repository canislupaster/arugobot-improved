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
  filterProblemsByRatingRanges,
  filterProblemsByTags,
  getProblemId,
  parseTagFilters,
  selectRandomProblem,
} from "../utils/problemSelection.js";
import { formatTime, getRatingChanges } from "../utils/rating.js";
import { resolveRatingRanges } from "../utils/ratingRanges.js";

import type { Command } from "./types.js";

const VALID_LENGTHS = new Set([40, 60, 80]);
const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;
const OPEN_LOBBY_TIMEOUT_MS = 5 * 60 * 1000;

function buildProblemLink(contestId: number, index: string, name: string) {
  return `[${index}. ${name}](https://codeforces.com/problemset/problem/${contestId}/${index})`;
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
    .addIntegerOption((option) =>
      option
        .setName("length")
        .setDescription("Challenge length in minutes")
        .setRequired(true)
        .addChoices({ name: "40", value: 40 }, { name: "60", value: 60 }, { name: "80", value: 80 })
    )
    .addStringOption((option) => option.setName("problem").setDescription("Problem id, e.g. 1000A"))
    .addIntegerOption((option) =>
      option.setName("rating").setDescription("Exact problem rating").setMinValue(0)
    )
    .addIntegerOption((option) =>
      option.setName("min_rating").setDescription("Minimum rating").setMinValue(0)
    )
    .addIntegerOption((option) =>
      option.setName("max_rating").setDescription("Maximum rating").setMinValue(0)
    )
    .addStringOption((option) =>
      option.setName("ranges").setDescription("Rating ranges (e.g. 800-1200, 1400, 1600-1800)")
    )
    .addStringOption((option) =>
      option
        .setName("tags")
        .setDescription("Problem tags (e.g. dp, greedy, -math)")
    )
    .addBooleanOption((option) =>
      option.setName("open").setDescription("Allow anyone to join before starting")
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
    const guildId = interaction.guild.id;
    const problemIdRaw = interaction.options.getString("problem");
    const rating = interaction.options.getInteger("rating");
    const minRatingOption = interaction.options.getInteger("min_rating");
    const maxRatingOption = interaction.options.getInteger("max_rating");
    const rangesRaw = interaction.options.getString("ranges");
    const tagsRaw = interaction.options.getString("tags");
    const openLobby = interaction.options.getBoolean("open") ?? false;
    const length = interaction.options.getInteger("length", true);

    if (!VALID_LENGTHS.has(length)) {
      await interaction.reply({
        content: "Invalid length. Valid lengths are 40, 60, and 80 minutes.",
        ephemeral: true,
      });
      return;
    }

    if (
      problemIdRaw &&
      (rating !== null ||
        minRatingOption !== null ||
        maxRatingOption !== null ||
        rangesRaw !== null ||
        tagsRaw !== null)
    ) {
      await interaction.reply({
        content: "Provide either a problem id or a rating range, not both.",
        ephemeral: true,
      });
      return;
    }

    const rangeResult = resolveRatingRanges({
      rating,
      minRating: minRatingOption,
      maxRating: maxRatingOption,
      rangesRaw,
      defaultMin: DEFAULT_MIN_RATING,
      defaultMax: DEFAULT_MAX_RATING,
    });
    if (!problemIdRaw && rangeResult.error) {
      await interaction.reply({ content: rangeResult.error, ephemeral: true });
      return;
    }

    let participantUsers = uniqueUsers(
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
      if (!(await context.services.store.handleLinked(guildId, user.id))) {
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
      const tagFilters = parseTagFilters(tagsRaw);
      const ratedCandidates = filterProblemsByRatingRanges(problems, rangeResult.ranges);
      const candidates = filterProblemsByTags(ratedCandidates, tagFilters);
      if (candidates.length === 0) {
        await interaction.reply({
          content: "No problems found for that rating range and tag filter.",
          ephemeral: true,
        });
        return;
      }

      const excludedIds = new Set<string>();
      for (const user of participantUsers) {
        const history = await context.services.store.getHistoryList(guildId, user.id);
        for (const problemId of history) {
          excludedIds.add(problemId);
        }
      }

      for (const user of participantUsers) {
        const handle = await context.services.store.getHandle(guildId, user.id);
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
      const history = await context.services.store.getHistoryList(guildId, user.id);
      if (history.includes(problemId)) {
        await interaction.reply({
          content: "One or more users have already done this problem.",
          ephemeral: true,
        });
        return;
      }
    }

    const logContext: LogContext = {
      correlationId: context.correlationId,
      command: "challenge",
      guildId,
      userId: interaction.user.id,
    };

    const buildUsersValue = async (users: User[]) => {
      let value = "";
      for (const user of users) {
        const rating = await context.services.store.getRating(guildId, user.id);
        const [down, up] = getRatingChanges(rating, problem.rating!, length);
        value += `- ${user} (${rating}) (don't solve: ${down}, solve: ${up})\n`;
      }
      return value || "No participants yet.";
    };

    const confirmParticipants = async (): Promise<boolean> => {
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
        )
        .addFields({
          name: "Users",
          value: await buildUsersValue(participantUsers),
          inline: false,
        });

      const confirmId = `challenge_confirm_${interaction.id}`;
      const cancelId = `challenge_cancel_${interaction.id}`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(confirmId)
          .setLabel("Confirm")
          .setStyle(ButtonStyle.Success),
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
        return false;
      }

      confirmEmbed.setDescription("Challenge confirmed.");
      await interaction.editReply({ embeds: [confirmEmbed], components: [] });
      return true;
    };

    const runOpenLobby = async (): Promise<User[] | null> => {
      const participants = new Map(participantUsers.map((user) => [user.id, user]));
      const lobbyEmbed = new EmbedBuilder()
        .setTitle("Open challenge lobby")
        .setDescription("Click Join to participate. The host can start when ready.")
        .setColor(0x3498db)
        .addFields(
          { name: "Time", value: formatTime(length * 60), inline: false },
          {
            name: "Problem",
            value: buildProblemLink(problem.contestId, problem.index, problem.name),
            inline: false,
          },
          { name: "Users", value: await buildUsersValue([...participants.values()]), inline: false }
        );

      const joinId = `challenge_join_${interaction.id}`;
      const startId = `challenge_start_${interaction.id}`;
      const cancelId = `challenge_cancel_${interaction.id}`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(joinId).setLabel("Join").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(startId).setLabel("Start").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );

      const response = await interaction.reply({
        embeds: [lobbyEmbed],
        components: [row],
        fetchReply: true,
      });

      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: OPEN_LOBBY_TIMEOUT_MS,
      });

      collector.on("collect", async (button) => {
        if (button.customId === joinId) {
          if (participants.has(button.user.id)) {
            await button.reply({ content: "You already joined.", ephemeral: true });
            return;
          }
          if (participants.size >= 5) {
            await button.reply({ content: "Lobby is full (max 5).", ephemeral: true });
            return;
          }
          const linked = await context.services.store.handleLinked(guildId, button.user.id);
          if (!linked) {
            await button.reply({ content: "Link a handle with /register first.", ephemeral: true });
            return;
          }
          const history = await context.services.store.getHistoryList(guildId, button.user.id);
          if (history.includes(problemId)) {
            await button.reply({
              content: "You have already done this problem in a prior challenge.",
              ephemeral: true,
            });
            return;
          }
          const handle = await context.services.store.getHandle(guildId, button.user.id);
          if (!handle) {
            await button.reply({
              content: "Missing handle data. Try again in a bit.",
              ephemeral: true,
            });
            return;
          }
          const solved = await context.services.store.getSolvedProblems(handle);
          if (!solved) {
            await button.reply({
              content: "Unable to verify solved problems right now. Try again later.",
              ephemeral: true,
            });
            return;
          }
          if (solved.includes(problemId)) {
            await button.reply({
              content: "You have already solved this problem on Codeforces.",
              ephemeral: true,
            });
            return;
          }
          participants.set(button.user.id, button.user);
          lobbyEmbed.spliceFields(2, 1, {
            name: "Users",
            value: await buildUsersValue([...participants.values()]),
            inline: false,
          });
          await button.update({ embeds: [lobbyEmbed], components: [row] });
          return;
        }

        if (button.customId === startId) {
          if (button.user.id !== interaction.user.id) {
            await button.reply({ content: "Only the host can start.", ephemeral: true });
            return;
          }
          lobbyEmbed.setDescription("Challenge starting.");
          await button.update({ embeds: [lobbyEmbed], components: [] });
          collector.stop("started");
          return;
        }

        if (button.customId === cancelId) {
          if (button.user.id !== interaction.user.id) {
            await button.reply({ content: "Only the host can cancel.", ephemeral: true });
            return;
          }
          lobbyEmbed.setDescription("Challenge cancelled.");
          await button.update({ embeds: [lobbyEmbed], components: [] });
          collector.stop("cancelled");
        }
      });

      const status = await new Promise<string>((resolve) => {
        collector.on("end", (_collected, reason) => resolve(reason));
      });

      if (status !== "started") {
        if (status !== "cancelled") {
          lobbyEmbed.setDescription("Lobby timed out.");
          await interaction.editReply({ embeds: [lobbyEmbed], components: [] });
        }
        return null;
      }

      return [...participants.values()];
    };

    if (openLobby) {
      const lobbyUsers = await runOpenLobby();
      if (!lobbyUsers) {
        return;
      }
      participantUsers = lobbyUsers;
    } else {
      const confirmed = await confirmParticipants();
      if (!confirmed) {
        return;
      }
    }

    const startTime = Math.floor(Date.now() / 1000);
    const participants = participantUsers.map((user, index) => ({
      userId: user.id,
      position: index,
      solvedAt: null,
    }));

    const challengeEmbed = await context.services.challenges.buildActiveEmbed({
      serverId: guildId,
      problem: {
        contestId: problem.contestId,
        index: problem.index,
        name: problem.name,
        rating: problem.rating!,
      },
      lengthMinutes: length,
      timeLeftSeconds: length * 60,
      participants,
    });

    const challengeMessage = await interaction.followUp({
      embeds: [challengeEmbed],
      fetchReply: true,
    });

    try {
      await context.services.challenges.createChallenge({
        serverId: guildId,
        channelId: interaction.channelId,
        messageId: challengeMessage.id,
        hostUserId: interaction.user.id,
        problem: {
          contestId: problem.contestId,
          index: problem.index,
          name: problem.name,
          rating: problem.rating!,
        },
        lengthMinutes: length,
        participants: participantUsers.map((user) => user.id),
        startedAt: startTime,
      });
    } catch (error) {
      logError(`Failed to start challenge: ${String(error)}`, logContext);
      await challengeMessage.edit({
        content: "Failed to start challenge. Please try again.",
        embeds: [],
      });
    }
  },
};
