import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { filterEntriesByGuildMembers, resolveMemberMentions } from "../utils/guildMembers.js";
import { requireGuildAndPage, resolveBoundedIntegerOption } from "../utils/interaction.js";
import {
  buildPageEmbed,
  buildPaginationIds,
  getPageSlice,
  getTotalPages,
  runPaginatedInteraction,
} from "../utils/pagination.js";
import { resolveGuildRoster } from "../utils/roster.js";
import { formatStreakEmojis } from "../utils/streaks.js";

import type { Command } from "./types.js";

const PAGE_SIZE = 10;

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
          { name: "Contests (90d)", value: "contests" },
          { name: "Current streak", value: "streak" },
          { name: "Longest streak", value: "longest_streak" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("days")
        .setDescription("Lookback window for contest leaderboard (1-365 days)")
        .setMinValue(1)
        .setMaxValue(365)
    )
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number (starting at 1)").setMinValue(1)
    ),
  async execute(interaction, context) {
    const guildAndPage = await requireGuildAndPage(interaction, {
      guildMessage: "This command can only be used in a server.",
    });
    if (!guildAndPage) {
      return;
    }
    const { guild, page } = guildAndPage;
    const metric = interaction.options.getString("metric") ?? "rating";
    let contestDays = 90;
    if (metric === "contests") {
      const dayResult = resolveBoundedIntegerOption(interaction, {
        name: "days",
        min: 1,
        max: 365,
        defaultValue: 90,
        errorMessage: "Invalid lookback window.",
      });
      if ("error" in dayResult) {
        await interaction.reply({ content: dayResult.error });
        return;
      }
      contestDays = dayResult.value;
    }

    await interaction.deferReply();

    const logContext = {
      correlationId: context.correlationId,
      command: interaction.commandName,
      guildId: guild.id,
      userId: interaction.user.id,
    };

    const filterRows = async (rows: Array<{ userId: string; value: number }>) =>
      filterEntriesByGuildMembers(guild, rows, logContext);

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
      const totalPages = getTotalPages(rows.length, PAGE_SIZE);
      const paginationIds = buildPaginationIds("leaderboard", interaction.id);
      const medals = [":first_place:", ":second_place:", ":third_place:"];
      const mentionMap = await resolveMemberMentions(
        guild,
        rows.map((entry) => entry.userId),
        logContext
      );

      const renderPage = async (pageNumber: number) => {
        let content = "";
        const pageSlice = getPageSlice(rows, pageNumber, PAGE_SIZE);
        if (!pageSlice) {
          return null;
        }
        pageSlice.items.forEach((entry, index) => {
          const rank = pageSlice.start + index + 1;
          const mention = mentionMap.get(entry.userId) ?? `<@${entry.userId}>`;
          const medal = medals[index] ? ` ${medals[index]}` : "";
          content += `${rank}. ${mention} (${formatValue(entry.value)})${medal}\n`;
        });

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

      if (metric === "contests") {
        const roster = await context.services.store.getServerRoster(guild.id);
        const rosterResult = await resolveGuildRoster(guild, roster, logContext);
        if (rosterResult.status === "empty") {
          await interaction.editReply(rosterResult.message);
          return;
        }
        const activity = await context.services.contestActivity.getContestActivityForRoster(
          rosterResult.roster,
          { lookbackDays: contestDays }
        );
        if (activity.contestCount === 0 || activity.participants.length === 0) {
          await interaction.editReply(
            `No contest activity for linked handles in the last ${contestDays} days.`
          );
          return;
        }
        const rows = activity.participants.map((participant) => ({
          userId: participant.userId,
          value: participant.contestCount,
        }));
        await renderLeaderboard(
          rows,
          `Contest leaderboard (${contestDays}d)`,
          "Contests"
        );
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
