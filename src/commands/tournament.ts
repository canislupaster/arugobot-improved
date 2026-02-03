import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

import type { TournamentHistoryDetail, TournamentHistoryEntry } from "../services/tournaments.js";
import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import {
  safeInteractionDefer,
  safeInteractionEdit,
  safeInteractionReply,
} from "../utils/interaction.js";
import {
  buildPaginationIds,
  buildPaginationRow,
  paginationTimeoutMs,
} from "../utils/pagination.js";
import { buildProblemUrl } from "../utils/problemReference.js";
import { formatTime } from "../utils/rating.js";
import { readRatingRangeOptions, resolveRatingRanges } from "../utils/ratingRanges.js";
import { capitalize } from "../utils/text.js";
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
const DEFAULT_SWISS_MIN_ROUNDS = 3;
const MAX_SWISS_ROUNDS = 10;
const MIN_ARENA_PROBLEM_COUNT = 3;
const DEFAULT_ARENA_PROBLEM_COUNT = 5;
const MAX_ARENA_PROBLEM_COUNT = 10;
const HISTORY_PAGE_SIZE = 5;
const HISTORY_SELECT_TIMEOUT_MS = 30_000;
const HISTORY_DETAIL_ROUND_LIMIT = 3;
const HISTORY_DETAIL_STANDINGS_LIMIT = 5;

type TournamentFormat = "swiss" | "elimination" | "arena";
type TournamentReplyPayload = string | InteractionReplyOptions;

async function respondToInteraction(
  interaction: ChatInputCommandInteraction,
  payload: TournamentReplyPayload
): Promise<void> {
  if (interaction.deferred) {
    const editPayload =
      typeof payload === "string" ? payload : (payload as InteractionEditReplyOptions);
    await safeInteractionEdit(interaction, editPayload);
    return;
  }
  if (interaction.replied) {
    const replyPayload = typeof payload === "string" ? { content: payload } : payload;
    await safeInteractionReply(interaction, replyPayload);
    return;
  }
  const replyPayload = typeof payload === "string" ? { content: payload } : payload;
  await safeInteractionReply(interaction, replyPayload);
}

async function deferIfNeeded(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  return safeInteractionDefer(interaction);
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

function buildLobbyUsersValue(userIds: string[]): string {
  if (userIds.length === 0) {
    return "No participants yet.";
  }
  return userIds.map((userId) => `- <@${userId}>`).join("\n");
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
  return `- ${statusLabel} • ${capitalize(entry.format)} • ${entry.participantCount} players • ${entry.roundCount} rounds • ${entry.lengthMinutes}m • Winner: ${winnerLabel} • ${timestamp}`;
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
      `${index + 1}. ${capitalize(entry.format)} • ${entry.lengthMinutes}m`,
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
    .setColor(EMBED_COLORS.info)
    .setDescription(
      `${statusLabel} • ${capitalize(detail.entry.format)} • ${detail.entry.lengthMinutes}m`
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
          detail.entry.format === "swiss"
            ? ` • TB ${formatScore(participant.tiebreak)}`
            : detail.entry.format === "arena"
              ? ` • ${formatTime(participant.tiebreak)}`
              : "";
        const status = participant.eliminated ? " • eliminated" : "";
        if (detail.entry.format === "arena") {
          return `${index + 1}. <@${participant.userId}> • ${participant.score} solves${tiebreak}${status}`;
        }
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
              { name: "Elimination", value: "elimination" },
              { name: "Arena", value: "arena" }
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
            .setName("problem_count")
            .setDescription(
              `Arena problems (${MIN_ARENA_PROBLEM_COUNT}-${MAX_ARENA_PROBLEM_COUNT})`
            )
            .setMinValue(MIN_ARENA_PROBLEM_COUNT)
            .setMaxValue(MAX_ARENA_PROBLEM_COUNT)
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
      subcommand.setName("join").setDescription("Join the open tournament lobby")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("leave").setDescription("Leave the open tournament lobby")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("start").setDescription("Start the open tournament lobby")
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
      await respondToInteraction(interaction, "This command can only be used in a server.");
      return;
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "history") {
        const page = interaction.options.getInteger("page") ?? 1;
        if (!Number.isInteger(page) || page < 1) {
          await respondToInteraction(interaction, "Invalid page.");
          return;
        }
        if (!(await deferIfNeeded(interaction))) {
          return;
        }
        const paginationIds = buildPaginationIds("tournament_history", interaction.id);
        const history = await context.services.tournaments.getHistoryPage(
          guildId,
          page,
          HISTORY_PAGE_SIZE
        );
        if (history.total === 0) {
          await interaction.editReply("No completed tournaments yet.");
          return;
        }
        const totalPages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));
        if (page > totalPages || history.entries.length === 0) {
          await interaction.editReply("Empty page.");
          return;
        }

        const selectId = `tournament_history_${interaction.id}`;
        const buildSelectRow = (entries: TournamentHistoryEntry[], disabled = false) => {
          const options = buildHistorySelectOptions(entries);
          return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(selectId)
              .setPlaceholder("Select a tournament for details")
              .addOptions(options)
              .setDisabled(disabled)
          );
        };

        const buildListEmbed = (entries: TournamentHistoryEntry[], pageNumber: number) => {
          const lines = entries.map((entry) => formatHistoryLine(entry));
          return new EmbedBuilder()
            .setTitle("Tournament history")
            .setDescription(`Page ${pageNumber} of ${totalPages}`)
            .setColor(EMBED_COLORS.info)
            .addFields({ name: "Recent tournaments", value: lines.join("\n"), inline: false });
        };

        let currentEntries = history.entries;
        let currentPage = page;
        let selectedTournamentId: string | null = null;
        let selectRow = buildSelectRow(currentEntries);
        let paginationRow = buildPaginationRow(paginationIds, currentPage, totalPages);
        const exportRow = buildHistoryExportRow(interaction.id, true);

        const response = await interaction.editReply({
          embeds: [buildListEmbed(currentEntries, currentPage)],
          components: [selectRow, paginationRow, exportRow],
        });

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
              await safeInteractionReply(selection, {
                content: "Only the command user can use this menu.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            await selection.deferUpdate();
            const selectedId = selection.values[0];
            selectedTournamentId = selectedId;
            const detail = await context.services.tournaments.getHistoryDetail(
              guildId,
              selectedId,
              HISTORY_DETAIL_ROUND_LIMIT,
              HISTORY_DETAIL_STANDINGS_LIMIT
            );
            if (!detail) {
              await safeInteractionEdit(selection, "Tournament not found.");
              return;
            }
            const detailEmbed = buildHistoryDetailEmbed(detail);
            const enabledExportRow = buildHistoryExportRow(interaction.id, false);
            await safeInteractionEdit(selection, {
              embeds: [detailEmbed],
              components: [selectRow, paginationRow, enabledExportRow],
            });
          } catch (error) {
            logCommandError(
              `Error in tournament history: ${String(error)}`,
              interaction,
              context.correlationId
            );
            if (!selection.deferred && !selection.replied) {
              await safeInteractionReply(selection, {
                content: "Something went wrong.",
                flags: MessageFlags.Ephemeral,
              });
            }
          }
        });

        const buttonCollector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: Math.min(HISTORY_SELECT_TIMEOUT_MS, paginationTimeoutMs),
        });

        buttonCollector.on("collect", async (button) => {
          try {
            if (button.user.id !== interaction.user.id) {
              await safeInteractionReply(button, {
                content: "Only the command user can use this button.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            if (button.customId === paginationIds.prev || button.customId === paginationIds.next) {
              await button.deferUpdate();
              currentPage =
                button.customId === paginationIds.prev
                  ? Math.max(1, currentPage - 1)
                  : Math.min(totalPages, currentPage + 1);
              const updated = await context.services.tournaments.getHistoryPage(
                guildId,
                currentPage,
                HISTORY_PAGE_SIZE
              );
              if (updated.entries.length === 0) {
                return;
              }
              currentEntries = updated.entries;
              selectedTournamentId = null;
              selectRow = buildSelectRow(currentEntries);
              paginationRow = buildPaginationRow(paginationIds, currentPage, totalPages);
              const disabledExportRow = buildHistoryExportRow(interaction.id, true);
              await safeInteractionEdit(interaction, {
                embeds: [buildListEmbed(currentEntries, currentPage)],
                components: [selectRow, paginationRow, disabledExportRow],
              });
              return;
            }

            const isCsv = button.customId === `tournament_recap_csv_${interaction.id}`;
            const isMarkdown = button.customId === `tournament_recap_md_${interaction.id}`;
            if (!isCsv && !isMarkdown) {
              return;
            }
            if (!selectedTournamentId) {
              await safeInteractionReply(button, {
                content: "Select a tournament first.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            await button.deferReply({ flags: MessageFlags.Ephemeral });
            const recap = await context.services.tournaments.getRecap(
              guildId,
              selectedTournamentId
            );
            if (!recap) {
              await safeInteractionEdit(button, "Tournament not found.");
              return;
            }
            const payload = isCsv
              ? formatTournamentRecapCsv(recap)
              : formatTournamentRecapMarkdown(recap);
            const extension = isCsv ? "csv" : "md";
            const shortId = selectedTournamentId.slice(0, 8);
            const filename = `tournament-recap-${shortId}.${extension}`;
            const file = new AttachmentBuilder(Buffer.from(payload), { name: filename });
            await safeInteractionEdit(button, {
              content: "Tournament recap export:",
              files: [file],
            });
          } catch (error) {
            logCommandError(
              `Error exporting tournament recap: ${String(error)}`,
              interaction,
              context.correlationId
            );
            if (button.deferred || button.replied) {
              await safeInteractionEdit(button, "Something went wrong.");
            } else {
              await safeInteractionReply(button, {
                content: "Something went wrong.",
                flags: MessageFlags.Ephemeral,
              });
            }
          }
        });

        collector.on("end", async () => {
          try {
            const disabledSelectRow = buildSelectRow(currentEntries, true);
            const disabledPaginationRow = buildPaginationRow(
              paginationIds,
              currentPage,
              totalPages,
              true
            );
            const disabledExportRow = buildHistoryExportRow(interaction.id, true);
            await safeInteractionEdit(interaction, {
              components: [disabledSelectRow, disabledPaginationRow, disabledExportRow],
            });
          } catch {
            return;
          }
        });
        return;
      }

      if (subcommand === "status") {
        if (!(await deferIfNeeded(interaction))) {
          return;
        }
        const tournament = await context.services.tournaments.getActiveTournament(guildId);
        if (!tournament) {
          const lobby = await context.services.tournaments.getLobby(guildId);
          if (!lobby) {
            await interaction.editReply({
              content: "No active tournament or lobby for this server.",
            });
            return;
          }
          const participants = await context.services.tournaments.listLobbyParticipants(lobby.id);
          const lobbyEmbed = new EmbedBuilder()
            .setTitle("Tournament lobby")
            .setDescription("Use /tournament join, /tournament leave, or /tournament start.")
            .setColor(EMBED_COLORS.info)
            .addFields(
              { name: "Format", value: capitalize(lobby.format), inline: true },
              { name: "Time", value: formatTime(lobby.lengthMinutes * 60), inline: true },
              { name: "Capacity", value: String(lobby.maxParticipants), inline: true },
              {
                name: "Rating ranges",
                value: formatRatingRanges(lobby.ratingRanges),
                inline: true,
              },
              { name: "Tags", value: formatTags(lobby.tags), inline: true },
              {
                name: "Participants",
                value: buildLobbyUsersValue(participants),
                inline: false,
              }
            );
          if (lobby.format === "arena") {
            lobbyEmbed.spliceFields(3, 0, {
              name: "Problems",
              value: String(lobby.arenaProblemCount ?? DEFAULT_ARENA_PROBLEM_COUNT),
              inline: true,
            });
          }
          if (lobby.format === "swiss" && lobby.swissRounds) {
            lobbyEmbed.addFields({
              name: "Swiss rounds",
              value: String(lobby.swissRounds),
              inline: true,
            });
          }
          await interaction.editReply({ embeds: [lobbyEmbed] });
          return;
        }

        if (tournament.format === "arena") {
          const arena = await context.services.tournaments.getArenaStatus(tournament.id);
          if (!arena) {
            await interaction.editReply({
              content: "Arena tournament details are unavailable.",
            });
            return;
          }
          const endsAtLabel = formatDiscordRelativeTime(arena.state.endsAt);
          const standingsValue = arena.standings
            .slice(0, 10)
            .map((participant, index) => {
              const timeLabel =
                participant.score > 0 ? ` • ${formatTime(participant.tiebreak)}` : "";
              return `${index + 1}. <@${participant.userId}> • ${participant.score} solves${timeLabel}`;
            })
            .join("\n");

          const problemLines = arena.problems
            .map((problem) => {
              const ratingLabel = problem.rating ? ` (${problem.rating})` : "";
              const url = buildProblemUrl(problem.contestId, problem.index);
              return `[${problem.contestId}${problem.index}](${url})${ratingLabel} • ${problem.name}`;
            })
            .join("\n");

          const embed = new EmbedBuilder()
            .setTitle("Active arena tournament")
            .setColor(EMBED_COLORS.info)
            .addFields(
              { name: "Ends", value: endsAtLabel, inline: true },
              {
                name: "Problems",
                value: problemLines || "No problems recorded.",
                inline: false,
              }
            );

          if (standingsValue) {
            embed.addFields({ name: "Standings (top 10)", value: standingsValue, inline: false });
          }

          await interaction.editReply({ embeds: [embed] });
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
          .setColor(EMBED_COLORS.info)
          .addFields(
            { name: "Format", value: capitalize(tournament.format), inline: true },
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

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (subcommand === "advance") {
        if (!(await deferIfNeeded(interaction))) {
          return;
        }
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
        if (!(await deferIfNeeded(interaction))) {
          return;
        }
        const tournament = await context.services.tournaments.getActiveTournament(guildId);
        if (!tournament) {
          const lobby = await context.services.tournaments.getLobby(guildId);
          if (!lobby) {
            await respondToInteraction(interaction, "No active tournament or lobby to cancel.");
            return;
          }
          const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
          if (!isAdmin && lobby.hostUserId !== interaction.user.id) {
            await respondToInteraction(
              interaction,
              "Only the host or an admin can cancel a lobby."
            );
            return;
          }
          const cancelled = await context.services.tournaments.cancelLobby(guildId);
          await respondToInteraction(
            interaction,
            cancelled ? "Tournament lobby cancelled." : "No lobby found."
          );
          return;
        }

        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!isAdmin && tournament.hostUserId !== interaction.user.id) {
          await respondToInteraction(
            interaction,
            "Only the host or an admin can cancel a tournament."
          );
          return;
        }

        const cancelled = await context.services.tournaments.cancelTournament(
          guildId,
          interaction.user.id,
          context.client
        );
        await respondToInteraction(
          interaction,
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
        const arenaProblemCount =
          interaction.options.getInteger("problem_count") ?? DEFAULT_ARENA_PROBLEM_COUNT;
        const { rating, minRating, maxRating, rangesRaw } = readRatingRangeOptions(interaction);
        const tagsRaw = interaction.options.getString("tags") ?? "";

        if (!VALID_LENGTHS.has(length)) {
          await respondToInteraction(
            interaction,
            "Invalid length. Valid lengths are 40, 60, and 80 minutes."
          );
          return;
        }

        if (maxParticipants < MIN_PARTICIPANTS || maxParticipants > MAX_PARTICIPANTS) {
          await respondToInteraction(
            interaction,
            `Invalid max participants. Choose ${MIN_PARTICIPANTS}-${MAX_PARTICIPANTS}.`
          );
          return;
        }

        if (
          format === "arena" &&
          (arenaProblemCount < MIN_ARENA_PROBLEM_COUNT ||
            arenaProblemCount > MAX_ARENA_PROBLEM_COUNT)
        ) {
          await respondToInteraction(
            interaction,
            `Invalid arena problem count. Choose ${MIN_ARENA_PROBLEM_COUNT}-${MAX_ARENA_PROBLEM_COUNT}.`
          );
          return;
        }

        const rangeResult = resolveRatingRanges({
          rating,
          minRating,
          maxRating,
          rangesRaw,
          defaultMin: DEFAULT_MIN_RATING,
          defaultMax: DEFAULT_MAX_RATING,
        });
        if (rangeResult.error) {
          await respondToInteraction(interaction, rangeResult.error);
          return;
        }

        if (!(await deferIfNeeded(interaction))) {
          return;
        }
        const existing = await context.services.tournaments.getActiveTournament(guildId);
        if (existing) {
          await interaction.editReply("An active tournament already exists for this server.");
          return;
        }
        const existingLobby = await context.services.tournaments.getLobby(guildId);
        if (existingLobby) {
          await interaction.editReply(
            "A tournament lobby is already open. Use /tournament join or /tournament start."
          );
          return;
        }

        const swissRounds = format === "swiss" ? (roundsOption ?? null) : null;
        const arenaCount = format === "arena" ? arenaProblemCount : null;
        const lobby = await context.services.tournaments.createLobby({
          guildId,
          channelId: interaction.channelId,
          hostUserId: interaction.user.id,
          format,
          lengthMinutes: length,
          maxParticipants,
          ratingRanges: rangeResult.ranges,
          tags: tagsRaw,
          swissRounds,
          arenaProblemCount: arenaCount,
        });
        const lobbyEmbed = new EmbedBuilder()
          .setTitle("Tournament lobby")
          .setDescription("Use /tournament join, /tournament leave, or /tournament start.")
          .setColor(EMBED_COLORS.info)
          .addFields(
            { name: "Format", value: capitalize(format), inline: true },
            { name: "Time", value: formatTime(length * 60), inline: true },
            { name: "Capacity", value: String(maxParticipants), inline: true },
            { name: "Rating ranges", value: formatRatingRanges(lobby.ratingRanges), inline: true },
            { name: "Tags", value: formatTags(lobby.tags), inline: true },
            { name: "Participants", value: buildLobbyUsersValue([lobby.hostUserId]) }
          );
        if (format === "arena") {
          lobbyEmbed.spliceFields(3, 0, {
            name: "Problems",
            value: String(arenaProblemCount),
            inline: true,
          });
        }
        if (format === "swiss" && swissRounds) {
          lobbyEmbed.addFields({ name: "Swiss rounds", value: String(swissRounds), inline: true });
        }
        await interaction.editReply({
          content: "Lobby created. Invite players with /tournament join.",
          embeds: [lobbyEmbed],
        });
        return;
      }

      if (subcommand === "join") {
        if (!(await deferIfNeeded(interaction))) {
          return;
        }
        const tournament = await context.services.tournaments.getActiveTournament(guildId);
        if (tournament) {
          await respondToInteraction(
            interaction,
            "A tournament is already active for this server."
          );
          return;
        }
        const lobby = await context.services.tournaments.getLobby(guildId);
        if (!lobby) {
          await respondToInteraction(
            interaction,
            "No tournament lobby is open. Use /tournament create first."
          );
          return;
        }
        const participants = await context.services.tournaments.listLobbyParticipants(lobby.id);
        if (participants.includes(interaction.user.id)) {
          await respondToInteraction(interaction, "You already joined.");
          return;
        }
        if (participants.length >= lobby.maxParticipants) {
          await respondToInteraction(interaction, `Lobby is full (max ${lobby.maxParticipants}).`);
          return;
        }
        const conflicts = await context.services.challenges.getActiveChallengesForUsers(guildId, [
          interaction.user.id,
        ]);
        if (conflicts.has(interaction.user.id)) {
          const challenge = conflicts.get(interaction.user.id)!;
          await respondToInteraction(
            interaction,
            `You are already in an active challenge in <#${challenge.channelId}> (ends ${formatDiscordRelativeTime(
              challenge.endsAt
            )}).`
          );
          return;
        }
        const linked = await context.services.store.handleLinked(guildId, interaction.user.id);
        if (!linked) {
          await respondToInteraction(interaction, "Link a handle with /register first.");
          return;
        }
        await context.services.tournaments.addLobbyParticipant(lobby.id, interaction.user.id);
        await respondToInteraction(
          interaction,
          `Joined the lobby (${participants.length + 1}/${lobby.maxParticipants}).`
        );
        return;
      }

      if (subcommand === "leave") {
        if (!(await deferIfNeeded(interaction))) {
          return;
        }
        const lobby = await context.services.tournaments.getLobby(guildId);
        if (!lobby) {
          await respondToInteraction(interaction, "No tournament lobby is open.");
          return;
        }
        if (lobby.hostUserId === interaction.user.id) {
          await respondToInteraction(
            interaction,
            "The host cannot leave. Use /tournament cancel to close the lobby."
          );
          return;
        }
        const removed = await context.services.tournaments.removeLobbyParticipant(
          lobby.id,
          interaction.user.id
        );
        await respondToInteraction(
          interaction,
          removed ? "You left the lobby." : "You are not in this lobby."
        );
        return;
      }

      if (subcommand === "start") {
        if (!(await deferIfNeeded(interaction))) {
          return;
        }
        const lobby = await context.services.tournaments.getLobby(guildId);
        if (!lobby) {
          await respondToInteraction(interaction, "No tournament lobby is open.");
          return;
        }
        const tournament = await context.services.tournaments.getActiveTournament(guildId);
        if (tournament) {
          await respondToInteraction(
            interaction,
            "A tournament is already active for this server."
          );
          return;
        }
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!isAdmin && lobby.hostUserId !== interaction.user.id) {
          await respondToInteraction(
            interaction,
            "Only the host or an admin can start the tournament."
          );
          return;
        }
        const participants = await context.services.tournaments.listLobbyParticipants(lobby.id);
        if (participants.length < MIN_PARTICIPANTS) {
          await respondToInteraction(
            interaction,
            `Need at least ${MIN_PARTICIPANTS} participants to start.`
          );
          return;
        }
        const rounds =
          lobby.format === "swiss"
            ? (lobby.swissRounds ??
              Math.max(DEFAULT_SWISS_MIN_ROUNDS, Math.ceil(Math.log2(participants.length))))
            : lobby.format === "elimination"
              ? Math.max(1, Math.ceil(Math.log2(participants.length)))
              : (lobby.arenaProblemCount ?? DEFAULT_ARENA_PROBLEM_COUNT);

        const result = await context.services.tournaments.createTournament({
          guildId,
          channelId: lobby.channelId,
          hostUserId: lobby.hostUserId,
          format: lobby.format,
          lengthMinutes: lobby.lengthMinutes,
          roundCount: rounds,
          ratingRanges: lobby.ratingRanges,
          tags: lobby.tags,
          participants,
          arenaProblemCount: lobby.arenaProblemCount ?? DEFAULT_ARENA_PROBLEM_COUNT,
          client: context.client,
        });
        await context.services.tournaments.cancelLobby(guildId);

        if (result.kind === "arena") {
          const problemsList = result.problems
            .map((problem) => {
              const url = buildProblemUrl(problem.contestId, problem.index);
              const ratingLabel = problem.rating ? ` (${problem.rating})` : "";
              return `- [${problem.contestId}${problem.index}](${url})${ratingLabel} • ${problem.name}`;
            })
            .join("\n");
          await respondToInteraction(
            interaction,
            `Arena tournament created with ${participants.length} participants. Ends ${formatDiscordRelativeTime(
              result.endsAt
            )}.\n${problemsList}`
          );
          return;
        }

        await respondToInteraction(
          interaction,
          `Tournament created with ${participants.length} participants. Round ${result.round.roundNumber} started (${result.round.matchCount} matches, ${result.round.byeCount} byes).`
        );
        return;
      }
    } catch (error) {
      logCommandError("Tournament command failed.", interaction, context.correlationId, {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await respondToInteraction(interaction, { content: "Something went wrong." });
      } catch (replyError) {
        logCommandError(
          "Tournament command error response failed.",
          interaction,
          context.correlationId,
          { error: replyError instanceof Error ? replyError.message : String(replyError) }
        );
      }
    }
  },
};
