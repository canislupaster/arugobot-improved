import { ComponentType, EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import {
  buildPaginationIds,
  buildPaginationRow,
  paginationTimeoutMs,
} from "../utils/pagination.js";
import { formatTime } from "../utils/rating.js";

import type { Command } from "./types.js";
import { EMBED_COLORS } from "../utils/embedColors.js";

const PAGE_SIZE = 10;

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
          const lines = pageData.entries.map((entry) => {
            const duration =
              entry.solvedAt === null
                ? "Not solved"
                : `Solved in ${formatTime(Math.max(0, entry.solvedAt - entry.startedAt))}`;
            const delta =
              entry.ratingDelta === null
                ? "N/A"
                : entry.ratingDelta > 0
                  ? `+${entry.ratingDelta}`
                  : String(entry.ratingDelta);
            return `- [${entry.problemId}. ${entry.name}](https://codeforces.com/problemset/problem/${entry.contestId}/${entry.index}) • ${duration} • ${delta}`;
          });

          const embed = new EmbedBuilder()
            .setTitle("History")
            .setDescription(`Page ${pageNumber} of ${totalPages}`)
            .setColor(EMBED_COLORS.info)
            .addFields({ name: "Challenges", value: lines.join("\n"), inline: false });

          const row = buildPaginationRow(paginationIds, pageNumber, totalPages);
          return { embed, row };
        };

        let currentPage = page;
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
              ephemeral: true,
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

      const renderPage = (pageNumber: number) => {
        const start = (pageNumber - 1) * PAGE_SIZE;
        if (start >= historyData.history.length) {
          return null;
        }

        let content = "";
        for (let i = 0; i < PAGE_SIZE; i += 1) {
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
          content += `- [${problemId}. ${problem.name}](https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}) (rating change: ${deltaLabel})\n`;
        }

        const embed = new EmbedBuilder()
          .setTitle("History")
          .setDescription(`Page ${pageNumber} of ${totalPages}`)
          .setColor(EMBED_COLORS.info)
          .addFields({ name: "Problems", value: content || "No entries.", inline: false });
        const row = buildPaginationRow(paginationIds, pageNumber, totalPages);
        return { embed, row };
      };

      let currentPage = page;
      const initial = renderPage(currentPage);
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
            ephemeral: true,
          });
          return;
        }
        await button.deferUpdate();
        currentPage =
          button.customId === paginationIds.prev
            ? Math.max(1, currentPage - 1)
            : Math.min(totalPages, currentPage + 1);
        const updated = renderPage(currentPage);
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
    } catch (error) {
      logCommandError(`Error in history: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
