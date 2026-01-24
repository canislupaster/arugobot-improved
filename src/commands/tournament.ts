import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type User,
} from "discord.js";

import type { TournamentHistoryDetail, TournamentHistoryEntry } from "../services/tournaments.js";
import { logCommandError } from "../utils/commandLogging.js";
import { formatTime } from "../utils/rating.js";
import { resolveRatingRanges } from "../utils/ratingRanges.js";
import { formatDiscordRelativeTime } from "../utils/time.js";
import {
  formatTournamentRecapCsv,
  formatTournamentRecapMarkdown,
} from "../utils/tournamentRecap.js";

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
const HISTORY_PAGE_SIZE = 5;
const HISTORY_SELECT_TIMEOUT_MS = 30_000;
const HISTORY_DETAIL_ROUND_LIMIT = 3;
const HISTORY_DETAIL_STANDINGS_LIMIT = 5;

type TournamentFormat = "swiss" | "elimination";

function formatTournamentFormat(format: TournamentFormat): string {
  return format === "swiss" ? "Swiss" : "Elimination";
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildUsersValue(users: User[]): string {
  if (users.length === 0) {
    return "No participants yet.";
  }
  return users.map((user) => `- ${user}`).join("\n");
}

function formatHistoryTimestamp(isoTimestamp: string): string {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) {
    return "Unknown time";
  }
  return formatDiscordRelativeTime(Math.floor(parsed / 1000));
}

function formatHistoryLine(entry: TournamentHistoryEntry): string {
  const statusLabel = entry.status === "completed" ? "Completed" : "Cancelled";
  const winnerLabel = entry.winnerId ? `<@${entry.winnerId}>` : "None";
  const timestamp = formatHistoryTimestamp(entry.updatedAt);
  return `- ${statusLabel} • ${formatTournamentFormat(entry.format)} • ${entry.participantCount} players • ${entry.roundCount} rounds • ${entry.lengthMinutes}m • Winner: ${winnerLabel} • ${timestamp}`;
}

function formatRatingRanges(ranges: Array<{ min: number; max: number }>): string {
  if (ranges.length === 0) {
    return "Any";
  }
  return ranges
    .map((range) => (range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`))
    .join(", ");
}

function formatTags(tags: string): string {
  const trimmed = tags.trim();
  return trimmed.length > 0 ? trimmed : "None";
}

function buildHistorySelectOptions(
  entries: TournamentHistoryEntry[]
): StringSelectMenuOptionBuilder[] {
  return entries.map((entry, index) => {
    const label = truncateLabel(
      `${index + 1}. ${formatTournamentFormat(entry.format)} • ${entry.lengthMinutes}m`,
      100
    );
    const statusLabel = entry.status === "completed" ? "Completed" : "Cancelled";
    const description = truncateLabel(
      `${statusLabel} • ${entry.participantCount} players • ${formatHistoryTimestamp(
        entry.updatedAt
      )}`,
      100
    );
    return new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setDescription(description)
      .setValue(entry.id);
  });
}

function buildHistoryExportRow(customIdSuffix: string, disabled: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament_recap_csv_${customIdSuffix}`)
      .setLabel("Export CSV")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`tournament_recap_md_${customIdSuffix}`)
      .setLabel("Export Markdown")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function formatRoundSummary(summary: TournamentHistoryDetail["rounds"][number]): string {
  const progress =
    summary.matchCount > 0
      ? `${summary.completedCount}/${summary.matchCount} complete`
      : "No matches";
  const byes = summary.byeCount > 0 ? ` • ${summary.byeCount} byes` : "";
  return `Round ${summary.roundNumber} (${summary.status}) • ${summary.problem.index}. ${summary.problem.name} • ${progress}${byes}`;
}

function buildHistoryDetailEmbed(detail: TournamentHistoryDetail): EmbedBuilder {
  const statusLabel = detail.entry.status === "completed" ? "Completed" : "Cancelled";
  const winnerLabel = detail.entry.winnerId ? `<@${detail.entry.winnerId}>` : "None";
  const rangeLabel = formatRatingRanges(detail.entry.ratingRanges);
  const tagLabel = formatTags(detail.entry.tags);
  const updatedAt = formatHistoryTimestamp(detail.entry.updatedAt);
  const embed = new EmbedBuilder()
    .setTitle("Tournament recap")
    .setColor(0x3498db)
    .setDescription(
      `${statusLabel} • ${formatTournamentFormat(detail.entry.format)} • ${detail.entry.lengthMinutes}m`
    )
    .addFields(
      { name: "Participants", value: String(detail.entry.participantCount), inline: true },
      { name: "Rounds", value: String(detail.entry.roundCount), inline: true },
      { name: "Winner", value: winnerLabel, inline: true },
      { name: "Channel", value: `<#${detail.channelId}>`, inline: true },
      { name: "Host", value: `<@${detail.hostUserId}>`, inline: true },
      { name: "Updated", value: updatedAt, inline: true }
    )
    .setFooter({ text: `Ranges: ${rangeLabel} • Tags: ${tagLabel}` });

  if (detail.standings.length > 0) {
    const standingsValue = detail.standings
      .map((participant, index) => {
        const tiebreak =
          detail.entry.format === "swiss" ? ` • TB ${formatScore(participant.tiebreak)}` : "";
        const status = participant.eliminated ? " • eliminated" : "";
        return `${index + 1}. <@${participant.userId}> • ${formatScore(
          participant.score
        )} pts (${participant.wins}-${participant.losses}-${participant.draws})${tiebreak}${status}`;
      })
      .join("\n");
    embed.addFields({
      name: `Standings (top ${detail.standings.length})`,
      value: standingsValue,
      inline: false,
    });
  }

  if (detail.rounds.length > 0) {
    const roundsValue = detail.rounds.map((summary) => formatRoundSummary(summary)).join("\n");
    embed.addFields({ name: "Recent rounds", value: roundsValue, inline: false });
  }

  return embed;
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
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("history")
        .setDescription("Show recently completed or cancelled tournaments")
        .addIntegerOption((option) =>
          option.setName("page").setDescription("Page number (starting at 1)").setMinValue(1)
        )
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
      if (subcommand === "history") {
        const page = interaction.options.getInteger("page") ?? 1;
        if (!Number.isInteger(page) || page < 1) {
          await interaction.reply({ content: "Invalid page.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const history = await context.services.tournaments.getHistoryPage(
          guildId,
          page,
          HISTORY_PAGE_SIZE
        );
        if (history.total === 0) {
          await interaction.editReply("No completed tournaments yet.");
          return;
        }
        if (history.entries.length === 0) {
          await interaction.editReply("Empty page.");
          return;
        }
        const totalPages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));
        const lines = history.entries.map((entry) => formatHistoryLine(entry));
        const embed = new EmbedBuilder()
          .setTitle("Tournament history")
          .setDescription(`Page ${page} of ${totalPages}`)
          .setColor(0x3498db)
          .addFields({ name: "Recent tournaments", value: lines.join("\n"), inline: false });
        const selectId = `tournament_history_${interaction.id}`;
        const exportRow = buildHistoryExportRow(interaction.id, true);
        const options = buildHistorySelectOptions(history.entries);
        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(selectId)
            .setPlaceholder("Select a tournament for details")
            .addOptions(options)
        );

        const response = await interaction.editReply({
          embeds: [embed],
          components: [row, exportRow],
        });
        let selectedTournamentId: string | null = null;

        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          time: HISTORY_SELECT_TIMEOUT_MS,
        });

        collector.on("collect", async (selection) => {
          try {
            if (selection.customId !== selectId) {
              return;
            }
            if (selection.user.id !== interaction.user.id) {
              await selection.reply({
                content: "Only the command user can use this menu.",
                ephemeral: true,
              });
              return;
            }
            const selectedId = selection.values[0];
            selectedTournamentId = selectedId;
            const detail = await context.services.tournaments.getHistoryDetail(
              guildId,
              selectedId,
              HISTORY_DETAIL_ROUND_LIMIT,
              HISTORY_DETAIL_STANDINGS_LIMIT
            );
            if (!detail) {
              await selection.reply({ content: "Tournament not found.", ephemeral: true });
              return;
            }
            const detailEmbed = buildHistoryDetailEmbed(detail);
            const enabledExportRow = buildHistoryExportRow(interaction.id, false);
            await selection.update({ embeds: [detailEmbed], components: [row, enabledExportRow] });
          } catch (error) {
            logCommandError(
              `Error in tournament history: ${String(error)}`,
              interaction,
              context.correlationId
            );
            if (!selection.replied) {
              await selection.reply({ content: "Something went wrong.", ephemeral: true });
            }
          }
        });

        const buttonCollector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: HISTORY_SELECT_TIMEOUT_MS,
        });

        buttonCollector.on("collect", async (button) => {
          try {
            if (button.user.id !== interaction.user.id) {
              await button.reply({
                content: "Only the command user can use this button.",
                ephemeral: true,
              });
              return;
            }
            const isCsv = button.customId === `tournament_recap_csv_${interaction.id}`;
            const isMarkdown = button.customId === `tournament_recap_md_${interaction.id}`;
            if (!isCsv && !isMarkdown) {
              return;
            }
            if (!selectedTournamentId) {
              await button.reply({
                content: "Select a tournament first.",
                ephemeral: true,
              });
              return;
            }

            await button.deferReply({ ephemeral: true });
            const recap = await context.services.tournaments.getRecap(
              guildId,
              selectedTournamentId
            );
            if (!recap) {
              await button.editReply("Tournament not found.");
              return;
            }
            const payload = isCsv
              ? formatTournamentRecapCsv(recap)
              : formatTournamentRecapMarkdown(recap);
            const extension = isCsv ? "csv" : "md";
            const shortId = selectedTournamentId.slice(0, 8);
            const filename = `tournament-recap-${shortId}.${extension}`;
            const file = new AttachmentBuilder(Buffer.from(payload), { name: filename });
            await button.editReply({ content: "Tournament recap export:", files: [file] });
          } catch (error) {
            logCommandError(
              `Error exporting tournament recap: ${String(error)}`,
              interaction,
              context.correlationId
            );
            if (!button.replied) {
              await button.reply({ content: "Something went wrong.", ephemeral: true });
            }
          }
        });

        collector.on("end", async () => {
          try {
            await interaction.editReply({ components: [] });
          } catch {
            return;
          }
        });
        return;
      }

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
              tournament.format === "swiss" ? ` • TB ${formatScore(participant.tiebreak)}` : "";
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
          const recapResult = await context.services.tournamentRecaps.postRecapForTournament(
            guildId,
            result.tournamentId,
            context.client,
            true
          );
          let recapNote = "";
          if (recapResult.status === "sent") {
            recapNote = ` Recap posted in <#${recapResult.channelId}>.`;
          } else if (recapResult.status === "channel_missing") {
            recapNote =
              " Recap channel is missing; use /tournamentrecaps set to update the channel.";
          } else if (recapResult.status === "error") {
            recapNote = " Recap failed to post.";
          }
          await interaction.editReply(
            result.winnerId
              ? `Tournament complete! Winner: <@${result.winnerId}>.${recapNote}`
              : `Tournament complete!${recapNote}`
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
