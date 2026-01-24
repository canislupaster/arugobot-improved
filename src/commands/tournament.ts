import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type User,
} from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { formatTime } from "../utils/rating.js";
import { resolveRatingRanges } from "../utils/ratingRanges.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const VALID_LENGTHS = new Set([40, 60, 80]);
const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;
const DEFAULT_MAX_PARTICIPANTS = 24;
const MIN_PARTICIPANTS = 2;
const MAX_PARTICIPANTS = 64;
const OPEN_LOBBY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SWISS_MIN_ROUNDS = 3;
const MAX_SWISS_ROUNDS = 10;

type TournamentFormat = "swiss" | "elimination";

function formatTournamentFormat(format: TournamentFormat): string {
  return format === "swiss" ? "Swiss" : "Elimination";
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildUsersValue(users: User[]): string {
  if (users.length === 0) {
    return "No participants yet.";
  }
  return users.map((user) => `- ${user}`).join("\n");
}

export const tournamentCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("tournament")
    .setDescription("Manage multi-round tournaments")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a new tournament lobby")
        .addStringOption((option) =>
          option
            .setName("format")
            .setDescription("Tournament format")
            .setRequired(true)
            .addChoices(
              { name: "Swiss", value: "swiss" },
              { name: "Elimination", value: "elimination" }
            )
        )
        .addIntegerOption((option) =>
          option
            .setName("length")
            .setDescription("Match length in minutes")
            .setRequired(true)
            .addChoices(
              { name: "40", value: 40 },
              { name: "60", value: 60 },
              { name: "80", value: 80 }
            )
        )
        .addIntegerOption((option) =>
          option
            .setName("rounds")
            .setDescription(`Swiss rounds (${DEFAULT_SWISS_MIN_ROUNDS}-${MAX_SWISS_ROUNDS})`)
            .setMinValue(DEFAULT_SWISS_MIN_ROUNDS)
            .setMaxValue(MAX_SWISS_ROUNDS)
        )
        .addIntegerOption((option) =>
          option
            .setName("max_participants")
            .setDescription(`Lobby cap (${MIN_PARTICIPANTS}-${MAX_PARTICIPANTS})`)
            .setMinValue(MIN_PARTICIPANTS)
            .setMaxValue(MAX_PARTICIPANTS)
        )
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
          option.setName("tags").setDescription("Problem tags (e.g. dp, greedy, -math)")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show the active tournament status")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("advance").setDescription("Advance to the next tournament round")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("cancel").setDescription("Cancel the active tournament")
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
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status") {
        const tournament = await context.services.tournaments.getActiveTournament(guildId);
        if (!tournament) {
          await interaction.reply({
            content: "No active tournament for this server.",
            ephemeral: true,
          });
          return;
        }

        const standings = await context.services.tournaments.getStandings(
          tournament.id,
          tournament.format
        );
        const activeCount = standings.filter((participant) => !participant.eliminated).length;
        const standingsValue = standings
          .slice(0, 10)
          .map((participant, index) => {
            const tiebreak =
              tournament.format === "swiss"
                ? ` • TB ${formatScore(participant.tiebreak)}`
                : "";
            const status = participant.eliminated ? " • eliminated" : "";
            return `${index + 1}. <@${participant.userId}> • ${formatScore(
              participant.score
            )} pts (${participant.wins}-${participant.losses}-${participant.draws})${tiebreak}${status}`;
          })
          .join("\n");

        const round = await context.services.tournaments.getCurrentRound(
          tournament.id,
          tournament.currentRound
        );
        const roundSummaries = await context.services.tournaments.listRoundSummaries(
          tournament.id,
          3
        );
        const currentSummary = roundSummaries.find(
          (summary) => summary.roundNumber === tournament.currentRound
        );
        const currentMatches =
          tournament.currentRound > 0
            ? await context.services.tournaments.listRoundMatches(
                tournament.id,
                tournament.currentRound
              )
            : [];
        const embed = new EmbedBuilder()
          .setTitle("Active tournament")
          .setColor(0x3498db)
          .addFields(
            { name: "Format", value: formatTournamentFormat(tournament.format), inline: true },
            {
              name: "Round",
              value: `${tournament.currentRound}/${tournament.roundCount}`,
              inline: true,
            },
            {
              name: "Participants",
              value: `${activeCount}/${standings.length}`,
              inline: true,
            }
          );

        if (round) {
          const progress =
            currentSummary && currentSummary.matchCount > 0
              ? `${currentSummary.completedCount}/${currentSummary.matchCount} complete`
              : "No matches yet";
          embed.addFields({
            name: "Current round",
            value: `${round.roundNumber} (${round.status}) • ${round.problem.index}. ${round.problem.name} • ${progress}`,
            inline: false,
          });
        }

        if (roundSummaries.length > 0) {
          const roundsValue = roundSummaries
            .map((summary) => {
              const progress =
                summary.matchCount > 0
                  ? `${summary.completedCount}/${summary.matchCount} complete`
                  : "No matches";
              const byes = summary.byeCount > 0 ? ` • ${summary.byeCount} byes` : "";
              return `Round ${summary.roundNumber} (${summary.status}) • ${summary.problem.index}. ${summary.problem.name} • ${progress}${byes}`;
            })
            .join("\n");
          embed.addFields({ name: "Recent rounds", value: roundsValue, inline: false });
        }

        if (currentMatches.length > 0) {
          const matchValue = currentMatches
            .slice(0, 10)
            .map((match) => {
              if (!match.player2Id) {
                return `${match.matchNumber}. <@${match.player1Id}> • bye`;
              }
              if (match.status === "pending") {
                return `${match.matchNumber}. <@${match.player1Id}> vs <@${match.player2Id}>`;
              }
              if (match.isDraw) {
                return `${match.matchNumber}. <@${match.player1Id}> drew <@${match.player2Id}>`;
              }
              if (!match.winnerId) {
                return `${match.matchNumber}. <@${match.player1Id}> vs <@${match.player2Id}> • pending`;
              }
              const loserId =
                match.winnerId === match.player1Id ? match.player2Id : match.player1Id;
              return `${match.matchNumber}. <@${match.winnerId}> def. <@${loserId}>`;
            })
            .join("\n");
          embed.addFields({ name: "Current round matches", value: matchValue, inline: false });
        }

        if (standingsValue) {
          embed.addFields({ name: "Standings (top 10)", value: standingsValue, inline: false });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (subcommand === "advance") {
        await interaction.deferReply({ ephemeral: true });
        const result = await context.services.tournaments.advanceTournament(
          guildId,
          context.client
        );
        if (result.status === "no_active") {
          await interaction.editReply("No active tournament to advance.");
          return;
        }
        if (result.status === "round_incomplete") {
          await interaction.editReply(
            `Round ${result.roundNumber} is still in progress. Complete all matches before advancing.`
          );
          return;
        }
        if (result.status === "completed") {
          await interaction.editReply(
            result.winnerId
              ? `Tournament complete! Winner: <@${result.winnerId}>.`
              : "Tournament complete!"
          );
          return;
        }
        if (result.status === "error") {
          await interaction.editReply(`Failed to advance: ${result.message}`);
          return;
        }

        const round = result.round;
        await interaction.editReply(
          `Round ${round.roundNumber} started with ${round.matchCount} matches (${round.byeCount} byes).`
        );
        return;
      }

      if (subcommand === "cancel") {
        const tournament = await context.services.tournaments.getActiveTournament(guildId);
        if (!tournament) {
          await interaction.reply({ content: "No active tournament to cancel.", ephemeral: true });
          return;
        }

        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!isAdmin && tournament.hostUserId !== interaction.user.id) {
          await interaction.reply({
            content: "Only the host or an admin can cancel a tournament.",
            ephemeral: true,
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });
        const cancelled = await context.services.tournaments.cancelTournament(
          guildId,
          interaction.user.id,
          context.client
        );
        await interaction.editReply(
          cancelled ? "Tournament cancelled." : "No active tournament to cancel."
        );
        return;
      }

      if (subcommand === "create") {
        const format = interaction.options.getString("format", true) as TournamentFormat;
        const length = interaction.options.getInteger("length", true);
        const maxParticipants =
          interaction.options.getInteger("max_participants") ?? DEFAULT_MAX_PARTICIPANTS;
        const roundsOption = interaction.options.getInteger("rounds");
        const rating = interaction.options.getInteger("rating");
        const minRatingOption = interaction.options.getInteger("min_rating");
        const maxRatingOption = interaction.options.getInteger("max_rating");
        const rangesRaw = interaction.options.getString("ranges");
        const tagsRaw = interaction.options.getString("tags") ?? "";

        if (!VALID_LENGTHS.has(length)) {
          await interaction.reply({
            content: "Invalid length. Valid lengths are 40, 60, and 80 minutes.",
            ephemeral: true,
          });
          return;
        }

        if (maxParticipants < MIN_PARTICIPANTS || maxParticipants > MAX_PARTICIPANTS) {
          await interaction.reply({
            content: `Invalid max participants. Choose ${MIN_PARTICIPANTS}-${MAX_PARTICIPANTS}.`,
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
        if (rangeResult.error) {
          await interaction.reply({ content: rangeResult.error, ephemeral: true });
          return;
        }

        await interaction.deferReply({ ephemeral: true });
        const existing = await context.services.tournaments.getActiveTournament(guildId);
        if (existing) {
          await interaction.editReply("An active tournament already exists for this server.");
          return;
        }

        const participants = new Map<string, User>([[interaction.user.id, interaction.user]]);
        const lobbyEmbed = new EmbedBuilder()
          .setTitle("Tournament lobby")
          .setDescription("Click Join to participate. The host can start when ready.")
          .setColor(0x3498db)
          .addFields(
            { name: "Format", value: formatTournamentFormat(format), inline: true },
            { name: "Time", value: formatTime(length * 60), inline: true },
            { name: "Capacity", value: String(maxParticipants), inline: true },
            { name: "Users", value: buildUsersValue([...participants.values()]), inline: false }
          );

        const joinId = `tournament_join_${interaction.id}`;
        const leaveId = `tournament_leave_${interaction.id}`;
        const startId = `tournament_start_${interaction.id}`;
        const cancelId = `tournament_cancel_${interaction.id}`;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(joinId).setLabel("Join").setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(leaveId)
            .setLabel("Leave")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(startId).setLabel("Start").setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(cancelId)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
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
              await button.reply({ content: "You already joined.", ephemeral: true });
              return;
            }
            if (participants.size >= maxParticipants) {
              await button.reply({
                content: `Lobby is full (max ${maxParticipants}).`,
                ephemeral: true,
              });
              return;
            }
            const conflicts = await context.services.challenges.getActiveChallengesForUsers(
              guildId,
              [button.user.id]
            );
            if (conflicts.has(button.user.id)) {
              const challenge = conflicts.get(button.user.id)!;
              await button.reply({
                content: `You are already in an active challenge in <#${challenge.channelId}> (ends ${formatDiscordRelativeTime(
                  challenge.endsAt
                )}).`,
                ephemeral: true,
              });
              return;
            }
            const linked = await context.services.store.handleLinked(guildId, button.user.id);
            if (!linked) {
              await button.reply({
                content: "Link a handle with /register first.",
                ephemeral: true,
              });
              return;
            }
            participants.set(button.user.id, button.user);
            lobbyEmbed.spliceFields(3, 1, {
              name: "Users",
              value: buildUsersValue([...participants.values()]),
              inline: false,
            });
            await button.update({ embeds: [lobbyEmbed], components: [row] });
            return;
          }

          if (button.customId === leaveId) {
            if (!participants.has(button.user.id)) {
              await button.reply({ content: "You are not in this lobby.", ephemeral: true });
              return;
            }
            if (button.user.id === interaction.user.id) {
              await button.reply({
                content: "The host cannot leave. Use cancel to stop the lobby.",
                ephemeral: true,
              });
              return;
            }
            participants.delete(button.user.id);
            lobbyEmbed.spliceFields(3, 1, {
              name: "Users",
              value: buildUsersValue([...participants.values()]),
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
            if (participants.size < MIN_PARTICIPANTS) {
              await button.reply({
                content: `Need at least ${MIN_PARTICIPANTS} participants to start.`,
                ephemeral: true,
              });
              return;
            }
            lobbyEmbed.setDescription("Tournament starting.");
            await button.update({ embeds: [lobbyEmbed], components: [] });
            collector.stop("started");
            return;
          }

          if (button.customId === cancelId) {
            if (button.user.id !== interaction.user.id) {
              await button.reply({ content: "Only the host can cancel.", ephemeral: true });
              return;
            }
            lobbyEmbed.setDescription("Tournament cancelled.");
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
          await interaction.editReply("Tournament was not started.");
          return;
        }

        const participantUsers = [...participants.values()];
        const rounds =
          format === "swiss"
            ? (roundsOption ??
              Math.max(DEFAULT_SWISS_MIN_ROUNDS, Math.ceil(Math.log2(participantUsers.length))))
            : Math.max(1, Math.ceil(Math.log2(participantUsers.length)));

        const result = await context.services.tournaments.createTournament({
          guildId,
          channelId: interaction.channelId,
          hostUserId: interaction.user.id,
          format,
          lengthMinutes: length,
          roundCount: rounds,
          ratingRanges: rangeResult.ranges,
          tags: tagsRaw,
          participants: participantUsers.map((user) => user.id),
          client: context.client,
        });

        await interaction.editReply(
          `Tournament created with ${participantUsers.length} participants. Round ${result.round.roundNumber} started (${result.round.matchCount} matches, ${result.round.byeCount} byes).`
        );
      }
    } catch (error) {
      logCommandError("Tournament command failed.", interaction, context.correlationId, {
        error: error instanceof Error ? error.message : String(error),
      });
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
      } else {
        await interaction.reply({ content: "Something went wrong.", ephemeral: true });
      }
    }
  },
};
