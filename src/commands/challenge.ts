import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
  type User,
} from "discord.js";

import { addRatingRangeOptions, addTagOptions } from "../utils/commandOptions.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { logError, type LogContext } from "../utils/logger.js";
import { buildProblemUrl } from "../utils/problemReference.js";
import {
  filterProblemsByRatingRanges,
  filterProblemsByTags,
  getProblemId,
  parseTagFilters,
  selectRandomProblem,
} from "../utils/problemSelection.js";
import { formatTime, getRatingChanges } from "../utils/rating.js";
import { readRatingRangeOptions, resolveRatingRanges } from "../utils/ratingRanges.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const VALID_LENGTHS = new Set([40, 60, 80]);
const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;
const DEFAULT_MAX_PARTICIPANTS = 5;
const MAX_PARTICIPANTS = 10;
const MIN_PARTICIPANTS = 2;
const OPEN_LOBBY_TIMEOUT_MS = 5 * 60 * 1000;
const PARTICIPANT_OPTION_NAMES = [
  "user1",
  "user2",
  "user3",
  "user4",
  "user5",
  "user6",
  "user7",
  "user8",
  "user9",
] as const;

function addLengthOption(subcommand: SlashCommandSubcommandBuilder) {
  return subcommand.addIntegerOption((option) =>
    option
      .setName("length")
      .setDescription("Challenge length in minutes")
      .setRequired(true)
      .addChoices({ name: "40", value: 40 }, { name: "60", value: 60 }, { name: "80", value: 80 })
  );
}

function addLobbyOptions(subcommand: SlashCommandSubcommandBuilder) {
  return subcommand
    .addBooleanOption((option) =>
      option.setName("open").setDescription("Allow anyone to join before starting")
    )
    .addIntegerOption((option) =>
      option
        .setName("max_participants")
        .setDescription(`Max participants (${MIN_PARTICIPANTS}-${MAX_PARTICIPANTS})`)
        .setMinValue(MIN_PARTICIPANTS)
        .setMaxValue(MAX_PARTICIPANTS)
    );
}

function addParticipantOptions(subcommand: SlashCommandSubcommandBuilder) {
  return subcommand
    .addUserOption((option) => option.setName("user1").setDescription("Participant 1 (optional)"))
    .addUserOption((option) => option.setName("user2").setDescription("Participant 2 (optional)"))
    .addUserOption((option) => option.setName("user3").setDescription("Participant 3 (optional)"))
    .addUserOption((option) => option.setName("user4").setDescription("Participant 4 (optional)"))
    .addUserOption((option) => option.setName("user5").setDescription("Participant 5 (optional)"))
    .addUserOption((option) => option.setName("user6").setDescription("Participant 6 (optional)"))
    .addUserOption((option) => option.setName("user7").setDescription("Participant 7 (optional)"))
    .addUserOption((option) => option.setName("user8").setDescription("Participant 8 (optional)"))
    .addUserOption((option) => option.setName("user9").setDescription("Participant 9 (optional)"));
}

function buildProblemLink(contestId: number, index: string, name: string) {
  return `[${index}. ${name}](${buildProblemUrl(contestId, index)})`;
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

function collectParticipantUsers(interaction: ChatInputCommandInteraction): User[] {
  const optionUsers = PARTICIPANT_OPTION_NAMES.map((name) =>
    interaction.options.getUser(name)
  ).filter(Boolean) as User[];
  return uniqueUsers([interaction.user, ...optionUsers]);
}

export const challengeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("challenge")
    .setDescription("Starts a challenge")
    .addSubcommand((subcommand) =>
      addParticipantOptions(
        addLobbyOptions(
          addLengthOption(
            subcommand.setName("problem").setDescription("Challenge a specific Codeforces problem")
          ).addStringOption((option) =>
            option.setName("problem").setDescription("Problem id, e.g. 1000A").setRequired(true)
          )
        )
      )
    )
    .addSubcommand((subcommand) =>
      addParticipantOptions(
        addLobbyOptions(
          addTagOptions(
            addRatingRangeOptions(
              addLengthOption(
                subcommand.setName("random").setDescription("Challenge a random unsolved problem")
              )
            )
          )
        )
      )
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    const isProblemChallenge = subcommand === "problem";
    const isRandomChallenge = subcommand === "random";
    if (!isProblemChallenge && !isRandomChallenge) {
      await interaction.reply({ content: "Unknown challenge mode." });
      return;
    }
    const guildId = interaction.guild.id;
    const problemIdRaw = interaction.options.getString("problem");
    const ratingOptions = isRandomChallenge
      ? readRatingRangeOptions(interaction)
      : { rating: null, minRating: null, maxRating: null, rangesRaw: null };
    const tagsRaw = isRandomChallenge ? interaction.options.getString("tags") : null;
    const openLobby = interaction.options.getBoolean("open") ?? false;
    const maxParticipantsOption = interaction.options.getInteger("max_participants");
    const maxParticipants = maxParticipantsOption ?? DEFAULT_MAX_PARTICIPANTS;
    const length = interaction.options.getInteger("length", true);

    if (!VALID_LENGTHS.has(length)) {
      await interaction.reply({
        content: "Invalid length. Valid lengths are 40, 60, and 80 minutes.",
      });
      return;
    }

    if (
      !Number.isInteger(maxParticipants) ||
      maxParticipants < MIN_PARTICIPANTS ||
      maxParticipants > MAX_PARTICIPANTS
    ) {
      await interaction.reply({
        content: `Invalid max participants. Choose ${MIN_PARTICIPANTS}-${MAX_PARTICIPANTS}.`,
      });
      return;
    }

    const rangeResult = isRandomChallenge
      ? resolveRatingRanges({
          rating: ratingOptions.rating,
          minRating: ratingOptions.minRating,
          maxRating: ratingOptions.maxRating,
          rangesRaw: ratingOptions.rangesRaw,
          defaultMin: DEFAULT_MIN_RATING,
          defaultMax: DEFAULT_MAX_RATING,
        })
      : null;
    if (isRandomChallenge && rangeResult?.error) {
      await interaction.reply({ content: rangeResult.error });
      return;
    }

    await interaction.deferReply();

    let participantUsers = collectParticipantUsers(interaction);
    const handleCache = new Map<string, string>();
    const solvedCache = new Map<string, string[]>();
    const ratingCache = new Map<string, number>();

    if (participantUsers.length > maxParticipants) {
      await interaction.editReply(`Too many users (limit is ${maxParticipants}).`);
      return;
    }

    const replyMissingHandle = async () => {
      await interaction.editReply("One or more users have not linked a handle.");
    };
    const editReply = async (content: string) => {
      await interaction.editReply(content);
    };
    const getHandleOrReply = async (
      userId: string,
      reply: (content: string) => Promise<void>
    ) => {
      const cached = handleCache.get(userId);
      if (cached) {
        return cached;
      }
      const handle = await context.services.store.getHandle(guildId, userId);
      if (!handle) {
        await reply("Missing handle data. Try again in a bit.");
        return null;
      }
      handleCache.set(userId, handle);
      return handle;
    };
    const getSolvedOrReply = async (
      handle: string,
      reply: (content: string) => Promise<void>,
      message: string
    ) => {
      const cached = solvedCache.get(handle);
      if (cached) {
        return cached;
      }
      const solved = await context.services.store.getSolvedProblems(handle);
      if (!solved) {
        await reply(message);
        return null;
      }
      solvedCache.set(handle, solved);
      return solved;
    };
    const getSolvedForUser = async (
      userId: string,
      reply: (content: string) => Promise<void>,
      message: string
    ) => {
      const handle = await getHandleOrReply(userId, reply);
      if (!handle) {
        return null;
      }
      return getSolvedOrReply(handle, reply, message);
    };
    const getRatingForUser = async (userId: string) => {
      const cached = ratingCache.get(userId);
      if (cached !== undefined) {
        return cached;
      }
      const rating = await context.services.store.getRating(guildId, userId);
      ratingCache.set(userId, rating);
      return rating;
    };

    for (const user of participantUsers) {
      if (!(await context.services.store.handleLinked(guildId, user.id))) {
        await replyMissingHandle();
        return;
      }
    }

    const activeChallenges = await context.services.challenges.getActiveChallengesForUsers(
      guildId,
      participantUsers.map((user) => user.id)
    );
    if (activeChallenges.size > 0) {
      const lines = participantUsers
        .filter((user) => activeChallenges.has(user.id))
        .map((user) => {
          const challenge = activeChallenges.get(user.id)!;
          return `- ${user} already in <#${challenge.channelId}> (ends ${formatDiscordRelativeTime(
            challenge.endsAt
          )})`;
        })
        .join("\n");
      await interaction.editReply(
        `Some participants are already in an active challenge:\n${lines}`
      );
      return;
    }

    const problems = await context.services.problems.ensureProblemsLoaded();
    if (problems.length === 0) {
      await interaction.editReply("Problem cache not ready yet. Try again in a bit.");
      return;
    }

    let problemId = "";
    let problem: (typeof problems)[number] | null = null;

    if (isProblemChallenge) {
      if (!problemIdRaw) {
        await interaction.editReply("Problem id is required.");
        return;
      }
      problemId = problemIdRaw.toUpperCase();
      const problemDict = context.services.problems.getProblemDict();
      problem = problemDict.get(problemId) ?? null;
      if (!problem) {
        await interaction.editReply(
          "Invalid problem. Make sure it is in the correct format (e.g., 1000A)."
        );
        return;
      }
    } else {
      const tagFilters = parseTagFilters(tagsRaw);
      const ratedCandidates = filterProblemsByRatingRanges(problems, rangeResult?.ranges ?? []);
      const candidates = filterProblemsByTags(ratedCandidates, tagFilters);
      if (candidates.length === 0) {
        await interaction.editReply("No problems found for that rating range and tag filter.");
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
        const solved = await getSolvedForUser(
          user.id,
          editReply,
          "Unable to fetch solved problems right now. Try again later."
        );
        if (!solved) {
          return;
        }
        for (const solvedId of solved) {
          excludedIds.add(solvedId);
        }
      }

      problem = selectRandomProblem(candidates, excludedIds);
      if (!problem) {
        await interaction.editReply(
          "No unsolved problems found for this group in that rating range."
        );
        return;
      }
      problemId = getProblemId(problem);
    }

    if (!problem) {
      await interaction.editReply("Problem selection failed. Try again in a moment.");
      return;
    }

    for (const user of participantUsers) {
      const history = await context.services.store.getHistoryList(guildId, user.id);
      if (history.includes(problemId)) {
        await interaction.editReply("One or more users have already done this problem.");
        return;
      }
    }

    if (problemIdRaw) {
      const solvedUsers: User[] = [];
      for (const user of participantUsers) {
        const solved = await getSolvedForUser(
          user.id,
          editReply,
          "Unable to fetch solved problems right now. Try again later."
        );
        if (!solved) {
          return;
        }
        if (solved.includes(problemId)) {
          solvedUsers.push(user);
        }
      }

      if (solvedUsers.length > 0) {
        const mentions = solvedUsers.map((user) => `<@${user.id}>`).join(", ");
        await interaction.editReply(
          `Some participants have already solved this problem on Codeforces: ${mentions}.`
        );
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
        const rating = await getRatingForUser(user.id);
        const [down, up] = getRatingChanges(rating, problem.rating!, length);
        value += `- ${user} (${rating}) (don't solve: ${down}, solve: ${up})\n`;
      }
      return value || "No participants yet.";
    };
    const updateUsersField = async (
      embed: EmbedBuilder,
      index: number,
      users: User[]
    ): Promise<void> => {
      embed.spliceFields(index, 1, { name: "Users", value: await buildUsersValue(users), inline: false });
    };

    const confirmParticipants = async (): Promise<boolean> => {
      const confirmEmbed = new EmbedBuilder()
        .setTitle("Confirm challenge")
        .setDescription("All participants must confirm within 30 seconds.")
        .setColor(EMBED_COLORS.info)
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

      const response = await interaction.followUp({
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
          await button.reply({ content: "You are not part of this challenge.", flags: MessageFlags.Ephemeral });
          return;
        }

        if (button.customId === cancelId) {
          if (button.user.id !== interaction.user.id) {
            await button.reply({ content: "Only the host can cancel.", flags: MessageFlags.Ephemeral });
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
          await response.edit({ embeds: [confirmEmbed], components: [] });
        }
        return false;
      }

      confirmEmbed.setDescription("Challenge confirmed.");
      await response.edit({ embeds: [confirmEmbed], components: [] });
      return true;
    };

    const runOpenLobby = async (): Promise<User[] | null> => {
      const participants = new Map(participantUsers.map((user) => [user.id, user]));
      const lobbyEmbed = new EmbedBuilder()
        .setTitle("Open challenge lobby")
        .setDescription("Click Join to participate. The host can start when ready.")
        .setColor(EMBED_COLORS.info)
        .addFields(
          { name: "Time", value: formatTime(length * 60), inline: false },
          {
            name: "Problem",
            value: buildProblemLink(problem.contestId, problem.index, problem.name),
            inline: false,
          },
          { name: "Capacity", value: String(maxParticipants), inline: true },
          { name: "Users", value: await buildUsersValue([...participants.values()]), inline: false }
        );

      const joinId = `challenge_join_${interaction.id}`;
      const leaveId = `challenge_leave_${interaction.id}`;
      const startId = `challenge_start_${interaction.id}`;
      const cancelId = `challenge_cancel_${interaction.id}`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(joinId).setLabel("Join").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(leaveId).setLabel("Leave").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(startId).setLabel("Start").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );

      const response = await interaction.followUp({
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
            await button.reply({ content: "You already joined.", flags: MessageFlags.Ephemeral });
            return;
          }
          if (participants.size >= maxParticipants) {
            await button.reply({
              content: `Lobby is full (max ${maxParticipants}).`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const conflicts = await context.services.challenges.getActiveChallengesForUsers(guildId, [
            button.user.id,
          ]);
          if (conflicts.has(button.user.id)) {
            const challenge = conflicts.get(button.user.id)!;
            await button.reply({
              content: `You are already in an active challenge in <#${challenge.channelId}> (ends ${formatDiscordRelativeTime(
                challenge.endsAt
              )}).`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const linked = await context.services.store.handleLinked(guildId, button.user.id);
          if (!linked) {
            await button.reply({
              content: "Link a handle with /register first.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const history = await context.services.store.getHistoryList(guildId, button.user.id);
          if (history.includes(problemId)) {
            await button.reply({
              content: "You have already done this problem in a prior challenge.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const solved = await getSolvedForUser(
            button.user.id,
            async (content) => {
              await button.reply({ content, flags: MessageFlags.Ephemeral });
            },
            "Unable to verify solved problems right now. Try again later."
          );
          if (!solved) {
            return;
          }
          if (solved.includes(problemId)) {
            await button.reply({
              content: "You have already solved this problem on Codeforces.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          participants.set(button.user.id, button.user);
          await updateUsersField(lobbyEmbed, 3, [...participants.values()]);
          await button.update({ embeds: [lobbyEmbed], components: [row] });
          return;
        }

        if (button.customId === leaveId) {
          if (!participants.has(button.user.id)) {
            await button.reply({ content: "You are not in this lobby.", flags: MessageFlags.Ephemeral });
            return;
          }
          if (button.user.id === interaction.user.id) {
            await button.reply({
              content: "The host cannot leave. Use cancel to stop the lobby.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          participants.delete(button.user.id);
          await updateUsersField(lobbyEmbed, 3, [...participants.values()]);
          await button.update({ embeds: [lobbyEmbed], components: [row] });
          return;
        }

        if (button.customId === startId) {
          if (button.user.id !== interaction.user.id) {
            await button.reply({ content: "Only the host can start.", flags: MessageFlags.Ephemeral });
            return;
          }
          lobbyEmbed.setDescription("Challenge starting.");
          await button.update({ embeds: [lobbyEmbed], components: [] });
          collector.stop("started");
          return;
        }

        if (button.customId === cancelId) {
          if (button.user.id !== interaction.user.id) {
            await button.reply({ content: "Only the host can cancel.", flags: MessageFlags.Ephemeral });
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
          await response.edit({ embeds: [lobbyEmbed], components: [] });
        }
        return null;
      }

      return [...participants.values()];
    };

    if (openLobby) {
      const lobbyUsers = await runOpenLobby();
      if (!lobbyUsers) {
        await interaction.editReply("Challenge was not started.");
        return;
      }
      participantUsers = lobbyUsers;
    } else {
      const confirmed = await confirmParticipants();
      if (!confirmed) {
        await interaction.editReply("Challenge was not started.");
        return;
      }
    }

    await interaction.editReply("Challenge confirmed. Posting details...");

    const startTime = Math.floor(Date.now() / 1000);
    const participants = participantUsers.map((user, index) => ({
      userId: user.id,
      position: index,
      solvedAt: null,
      ratingBefore: null,
      ratingDelta: null,
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
      await interaction.editReply("Challenge started.");
    } catch (error) {
      logError(`Failed to start challenge: ${String(error)}`, logContext);
      await challengeMessage.edit({
        content: "Failed to start challenge. Please try again.",
        embeds: [],
      });
      await interaction.editReply("Failed to start the challenge.");
    }
  },
};
