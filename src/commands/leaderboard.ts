import {
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import {
  buildPaginationIds,
  buildPaginationRow,
  paginationTimeoutMs,
} from "../utils/pagination.js";
import { formatStreakEmojis } from "../utils/streaks.js";

import type { Command } from "./types.js";

export const leaderboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Shows the server leaderboard")
    .addStringOption((option) =>
      option
        .setName("metric")
        .setDescription("What to rank")
        .addChoices(
          { name: "Rating", value: "rating" },
          { name: "Solves", value: "solves" },
          { name: "Current streak", value: "streak" },
          { name: "Longest streak", value: "longest_streak" }
        )
    )
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
    const guild = interaction.guild;
    const page = interaction.options.getInteger("page") ?? 1;
    const metric = interaction.options.getString("metric") ?? "rating";
    if (!Number.isInteger(page) || page < 1) {
      await interaction.reply({ content: "Invalid page." });
      return;
    }

    await interaction.deferReply();

    const renderLeaderboard = async (
      rows: Array<{ userId: string; value: number }>,
      title: string,
      fieldName: string,
      formatValue: (value: number) => string = (value) => String(value)
    ) => {
      const totalPages = Math.max(1, Math.ceil(rows.length / 10));
      const paginationIds = buildPaginationIds("leaderboard", interaction.id);
      let currentPage = page;

      const renderPage = async (pageNumber: number) => {
        let content = "";
        const start = (pageNumber - 1) * 10;
        if (start >= rows.length) {
          return null;
        }
        for (let i = 0; i < 10; i += 1) {
          const index = start + i;
          if (index >= rows.length) {
            break;
          }
          const entry = rows[index];
          const member = await guild.members.fetch(entry.userId).catch(() => null);
          const mention = member ? member.toString() : `<@${entry.userId}>`;
          content += `${index + 1}. ${mention} (${formatValue(entry.value)})`;
          if (index === 0) {
            content += " :first_place:\n";
          } else if (index === 1) {
            content += " :second_place:\n";
          } else if (index === 2) {
            content += " :third_place:\n";
          } else {
            content += "\n";
          }
        }

        const embed = new EmbedBuilder()
          .setTitle(title)
          .setDescription(`Page ${pageNumber} of ${totalPages}`)
          .setColor(0x3498db)
          .addFields({ name: fieldName, value: content || "No entries.", inline: false });
        const row = buildPaginationRow(paginationIds, pageNumber, totalPages);
        return { embed, row };
      };

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
          button.customId === paginationIds.prev ? currentPage - 1 : currentPage + 1;
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
    };

    try {
      if (metric === "solves") {
        const leaderboard = await context.services.store.getSolveLeaderboard(interaction.guild.id);
        if (!leaderboard || leaderboard.length === 0) {
          await interaction.editReply("No solves recorded yet.");
          return;
        }
        await renderLeaderboard(
          leaderboard.map((entry) => ({ userId: entry.userId, value: entry.solvedCount })),
          "Solve leaderboard",
          "Solves"
        );
        return;
      }

      if (metric === "streak" || metric === "longest_streak") {
        const leaderboard = await context.services.store.getStreakLeaderboard(interaction.guild.id);
        if (!leaderboard || leaderboard.length === 0) {
          await interaction.editReply("No streaks recorded yet.");
          return;
        }
        const entries = leaderboard.map((entry) => ({
          userId: entry.userId,
          value: metric === "streak" ? entry.currentStreak : entry.longestStreak,
        }));
        const formatValue = (value: number) => {
          const emojis = formatStreakEmojis(value);
          return emojis ? `${value} ${emojis}` : String(value);
        };
        await renderLeaderboard(
          entries,
          metric === "streak" ? "Current streak leaderboard" : "Longest streak leaderboard",
          metric === "streak" ? "Current streak (days)" : "Longest streak (days)",
          formatValue
        );
        return;
      }

      const leaderboard = await context.services.store.getLeaderboard(interaction.guild.id);
      if (!leaderboard || leaderboard.length === 0) {
        await interaction.editReply("No leaderboard entries yet.");
        return;
      }
      await renderLeaderboard(
        leaderboard.map((entry) => ({ userId: entry.userId, value: entry.rating })),
        "Leaderboard",
        "Users"
      );
    } catch (error) {
      logCommandError(
        `Error during leaderboard command: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
