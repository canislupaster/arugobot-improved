import { SlashCommandBuilder } from "discord.js";

import type { Problem } from "../services/problems.js";
import { logCommandError } from "../utils/commandLogging.js";
import { buildProblemLink } from "../utils/contestProblems.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { requireGuild, resolvePageOption } from "../utils/interaction.js";
import {
  buildPageEmbed,
  buildPaginationIds,
  runPaginatedInteraction,
} from "../utils/pagination.js";
import { formatTime } from "../utils/rating.js";

import type { Command } from "./types.js";

const PAGE_SIZE = 10;

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
    const link = buildProblemLink({ contestId: entry.contestId, index: entry.index });
    const label = `[${entry.problemId}. ${entry.name}](${link})`;
    return `- ${label} • ${duration} • ${delta}`;
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
    const link = buildProblemLink(problem);
    lines.push(`- [${problemId}. ${problem.name}](${link}) (rating change: ${deltaLabel})`);
  }
  return lines;
};

type TargetInfo = {
  id: string;
  title: string;
  mention: string;
};

function getTargetInfo(viewerId: string, targetId: string): TargetInfo {
  const isSelf = viewerId === targetId;
  const mention = isSelf ? "you" : `<@${targetId}>`;
  const title = `History: ${isSelf ? "You" : `<@${targetId}>`}`;
  return { id: targetId, title, mention };
}

export const historyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Shows challenge history for you or another user")
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number (starting at 1)").setMinValue(1)
    )
    .addUserOption((option) => option.setName("user").setDescription("User to inspect")),
  async execute(interaction, context) {
    const guild = await requireGuild(interaction, {
      content: "This command can only be used in a server.",
    });
    if (!guild) {
      return;
    }
    const guildId = guild.id;
    const pageResult = resolvePageOption(interaction);
    if ("error" in pageResult) {
      await interaction.reply({ content: pageResult.error });
      return;
    }
    const page = pageResult.value;
    const targetUser = interaction.options.getUser("user") ?? interaction.user;
    const targetInfo = getTargetInfo(interaction.user.id, targetUser.id);

    await interaction.deferReply();

    try {
      const paginationIds = buildPaginationIds("history", interaction.id);
      const initialPage = await context.services.store.getChallengeHistoryPage(
        guildId,
        targetInfo.id,
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
          const embed = buildPageEmbed({
            title: targetInfo.title,
            pageNumber,
            totalPages,
            fieldName: "Challenges",
            fieldValue: lines.join("\n"),
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
        return;
      }

      const historyData = await context.services.store.getHistoryWithRatings(
        guildId,
        targetInfo.id
      );
      if (!historyData) {
        await interaction.editReply(`No history yet for ${targetInfo.mention}.`);
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
        const embed = buildPageEmbed({
          title: targetInfo.title,
          pageNumber,
          totalPages,
          fieldName: "Problems",
          fieldValue: lines.length > 0 ? lines.join("\n") : "No entries.",
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
    } catch (error) {
      logCommandError(`Error in history: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
