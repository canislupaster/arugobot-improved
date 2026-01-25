import {
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

import type { Problem } from "../services/problems.js";
import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import {
  buildPaginationIds,
  buildPaginationRow,
  paginationTimeoutMs,
  type PaginationIds,
} from "../utils/pagination.js";
import { formatTime } from "../utils/rating.js";

import type { Command } from "./types.js";

const PAGE_SIZE = 10;

type PaginatedRender = {
  embed: EmbedBuilder;
  row: ReturnType<typeof buildPaginationRow>;
};

type ChallengeHistoryEntry = {
  problemId: string;
  contestId: number;
  index: string;
  name: string;
  startedAt: number;
  solvedAt: number | null;
  ratingDelta: number | null;
};

type LegacyHistoryData = {
  history: string[];
  ratingHistory: number[];
};

const buildProblemLink = (
  problemId: string,
  contestId: number,
  index: string,
  name: string
) => `[${problemId}. ${name}](https://codeforces.com/problemset/problem/${contestId}/${index})`;

const buildHistoryEmbed = (
  pageNumber: number,
  totalPages: number,
  fieldName: string,
  fieldValue: string
) =>
  new EmbedBuilder()
    .setTitle("History")
    .setDescription(`Page ${pageNumber} of ${totalPages}`)
    .setColor(EMBED_COLORS.info)
    .addFields({ name: fieldName, value: fieldValue, inline: false });

const formatChallengeDelta = (ratingDelta: number | null) => {
  if (ratingDelta === null) {
    return "N/A";
  }
  return ratingDelta > 0 ? `+${ratingDelta}` : String(ratingDelta);
};

const renderChallengeHistoryLines = (entries: ChallengeHistoryEntry[]) =>
  entries.map((entry) => {
    const duration =
      entry.solvedAt === null
        ? "Not solved"
        : `Solved in ${formatTime(Math.max(0, entry.solvedAt - entry.startedAt))}`;
    const delta = formatChallengeDelta(entry.ratingDelta);
    const link = buildProblemLink(entry.problemId, entry.contestId, entry.index, entry.name);
    return `- ${link} • ${duration} • ${delta}`;
  });

const renderLegacyHistoryLines = (
  historyData: LegacyHistoryData,
  problemDict: Map<string, Problem>,
  start: number,
  pageSize: number
) => {
  const lines: string[] = [];
  for (let i = 0; i < pageSize; i += 1) {
    const index = start + i;
    if (index >= historyData.history.length) {
      break;
    }
    const problemId = historyData.history[index];
    const problem = problemDict.get(problemId);
    if (!problem) {
      continue;
    }
    const previous = historyData.ratingHistory[index];
    const next = historyData.ratingHistory[index + 1];
    const delta = Number.isFinite(previous) && Number.isFinite(next) ? next - previous : null;
    const deltaLabel = delta === null ? "N/A" : String(delta);
    const link = buildProblemLink(problemId, problem.contestId, problem.index, problem.name);
    lines.push(`- ${link} (rating change: ${deltaLabel})`);
  }
  return lines;
};

async function runPagination(options: {
  interaction: ChatInputCommandInteraction;
  paginationIds: PaginationIds;
  initialPage: number;
  totalPages: number;
  renderPage: (pageNumber: number) => Promise<PaginatedRender | null>;
}): Promise<void> {
  const { interaction, paginationIds, initialPage, totalPages, renderPage } = options;
  let currentPage = initialPage;
  const initial = await renderPage(currentPage);
  if (!initial) {
    await interaction.editReply("Empty page.");
    return;
  }
  const response = await interaction.editReply({
    embeds: [initial.embed],
    components: [initial.row],
  });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: paginationTimeoutMs,
  });

  collector.on("collect", async (button) => {
    if (button.customId !== paginationIds.prev && button.customId !== paginationIds.next) {
      return;
    }
    if (button.user.id !== interaction.user.id) {
      await button.reply({
        content: "Only the command user can use these buttons.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await button.deferUpdate();
    currentPage =
      button.customId === paginationIds.prev
        ? Math.max(1, currentPage - 1)
        : Math.min(totalPages, currentPage + 1);
    const updated = await renderPage(currentPage);
    if (!updated) {
      return;
    }
    await interaction.editReply({ embeds: [updated.embed], components: [updated.row] });
  });

  collector.on("end", async () => {
    try {
      const disabledRow = buildPaginationRow(paginationIds, currentPage, totalPages, true);
      await interaction.editReply({ components: [disabledRow] });
    } catch {
      return;
    }
  });
}

export const historyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Shows your challenge history")
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number (starting at 1)").setMinValue(1)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }
    const guildId = interaction.guild.id;
    const page = interaction.options.getInteger("page") ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      await interaction.reply({ content: "Invalid page." });
      return;
    }

    await interaction.deferReply();

    try {
      const paginationIds = buildPaginationIds("history", interaction.id);
      const initialPage = await context.services.store.getChallengeHistoryPage(
        guildId,
        interaction.user.id,
        page,
        PAGE_SIZE
      );

      if (initialPage.total > 0) {
        const totalPages = Math.max(1, Math.ceil(initialPage.total / PAGE_SIZE));
        if (page > totalPages) {
          await interaction.editReply("Empty page.");
          return;
        }
        const renderPage = async (pageNumber: number) => {
          const pageData =
            pageNumber === page
              ? initialPage
              : await context.services.store.getChallengeHistoryPage(
                  guildId,
                  interaction.user.id,
                  pageNumber,
                  PAGE_SIZE
                );
          if (pageData.entries.length === 0) {
            return null;
          }
          const lines = renderChallengeHistoryLines(pageData.entries);
          const embed = buildHistoryEmbed(
            pageNumber,
            totalPages,
            "Challenges",
            lines.join("\n")
          );
          const row = buildPaginationRow(paginationIds, pageNumber, totalPages);
          return { embed, row };
        };

        await runPagination({
          interaction,
          paginationIds,
          initialPage: page,
          totalPages,
          renderPage,
        });
        return;
      }

      const historyData = await context.services.store.getHistoryWithRatings(
        guildId,
        interaction.user.id
      );
      if (!historyData) {
        await interaction.editReply("No history yet.");
        return;
      }
      const problemDict = context.services.problems.getProblemDict();
      if (problemDict.size === 0) {
        await interaction.editReply("Problem cache not ready yet.");
        return;
      }
      const totalPages = Math.max(1, Math.ceil(historyData.history.length / PAGE_SIZE));
      if (page > totalPages) {
        await interaction.editReply("Empty page.");
        return;
      }

      const renderPage = async (pageNumber: number) => {
        const start = (pageNumber - 1) * PAGE_SIZE;
        if (start >= historyData.history.length) {
          return null;
        }

        const lines = renderLegacyHistoryLines(historyData, problemDict, start, PAGE_SIZE);
        const embed = buildHistoryEmbed(
          pageNumber,
          totalPages,
          "Problems",
          lines.length > 0 ? lines.join("\n") : "No entries."
        );
        const row = buildPaginationRow(paginationIds, pageNumber, totalPages);
        return { embed, row };
      };
      await runPagination({
        interaction,
        paginationIds,
        initialPage: page,
        totalPages,
        renderPage,
      });
    } catch (error) {
      logCommandError(`Error in history: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
