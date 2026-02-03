import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";
import { requireGuild, resolvePageOption } from "../utils/interaction.js";
import {
  buildPageEmbed,
  buildPaginationIds,
  runPaginatedInteraction,
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
    const guild = await requireGuild(interaction, {
      content: "This command can only be used in a server.",
    });
    if (!guild) {
      return;
    }
    const pageResult = resolvePageOption(interaction);
    if ("error" in pageResult) {
      await interaction.reply({ content: pageResult.error });
      return;
    }
    const page = pageResult.value;
    const metric = interaction.options.getString("metric") ?? "rating";

    await interaction.deferReply();

    const filterRows = async (rows: Array<{ userId: string; value: number }>) =>
      filterEntriesByGuildMembers(guild, rows, {
        correlationId: context.correlationId,
        command: interaction.commandName,
        guildId: guild.id,
        userId: interaction.user.id,
      });

    const ensureRows = async (
      rows: Array<{ userId: string; value: number }>,
      emptyMessage: string,
      emptyFilteredMessage: string
    ) => {
      if (!rows.length) {
        await interaction.editReply(emptyMessage);
        return null;
      }
      const filtered = await filterRows(rows);
      if (!filtered.length) {
        await interaction.editReply(emptyFilteredMessage);
        return null;
      }
      return filtered;
    };

    const renderLeaderboard = async (
      rows: Array<{ userId: string; value: number }>,
      title: string,
      fieldName: string,
      formatValue: (value: number) => string = (value) => String(value)
    ) => {
      const totalPages = Math.max(1, Math.ceil(rows.length / 10));
      const paginationIds = buildPaginationIds("leaderboard", interaction.id);
      const medals = [":first_place:", ":second_place:", ":third_place:"];

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
          const medal = medals[i] ? ` ${medals[i]}` : "";
          content += `${index + 1}. ${mention} (${formatValue(entry.value)})${medal}\n`;
        }

        const embed = buildPageEmbed({
          title,
          pageNumber,
          totalPages,
          fieldName,
          fieldValue: content || "No entries.",
          color: EMBED_COLORS.info,
        });
        return { embed };
      };

      await runPaginatedInteraction({
        interaction,
        paginationIds,
        initialPage: page,
        totalPages,
        renderPage,
      });
    };

    try {
      if (metric === "solves") {
        const leaderboard = await context.services.store.getSolveLeaderboard(guild.id);
        const rows = await ensureRows(
          leaderboard?.map((entry) => ({ userId: entry.userId, value: entry.solvedCount })) ?? [],
          "No solves recorded yet.",
          "No solves recorded for current members."
        );
        if (!rows) {
          return;
        }
        await renderLeaderboard(rows, "Solve leaderboard", "Solves");
        return;
      }

      if (metric === "streak" || metric === "longest_streak") {
        const leaderboard = await context.services.store.getStreakLeaderboard(guild.id);
        const entries =
          leaderboard?.map((entry) => ({
            userId: entry.userId,
            value: metric === "streak" ? entry.currentStreak : entry.longestStreak,
          })) ?? [];
        const rows = await ensureRows(
          entries,
          "No streaks recorded yet.",
          "No streaks recorded for current members."
        );
        if (!rows) {
          return;
        }
        const formatValue = (value: number) => {
          const emojis = formatStreakEmojis(value);
          return emojis ? `${value} ${emojis}` : String(value);
        };
        await renderLeaderboard(
          rows,
          metric === "streak" ? "Current streak leaderboard" : "Longest streak leaderboard",
          metric === "streak" ? "Current streak (days)" : "Longest streak (days)",
          formatValue
        );
        return;
      }

      const leaderboard = await context.services.store.getLeaderboard(guild.id);
      const rows = await ensureRows(
        leaderboard?.map((entry) => ({ userId: entry.userId, value: entry.rating })) ?? [],
        "No leaderboard entries yet.",
        "No leaderboard entries for current members."
      );
      if (!rows) {
        return;
      }
      await renderLeaderboard(rows, "Leaderboard", "Users");
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
