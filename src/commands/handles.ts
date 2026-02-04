import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { addPageOption } from "../utils/commandOptions.js";
import { requireGuildAndPage } from "../utils/interaction.js";
import {
  buildPageEmbed,
  buildPaginationIds,
  getPageSlice,
  getTotalPages,
  runPaginatedInteraction,
} from "../utils/pagination.js";
import { formatRatedRosterLines, resolveGuildRoster } from "../utils/roster.js";

import type { Command } from "./types.js";

const PAGE_SIZE = 10;

export const handlesCommand: Command = {
  data: addPageOption(
    new SlashCommandBuilder()
      .setName("handles")
      .setDescription("Lists linked Codeforces handles for this server")
  ),
  async execute(interaction, context) {
    const guildAndPage = await requireGuildAndPage(interaction, {
      guildMessage: "This command can only be used in a server.",
    });
    if (!guildAndPage) {
      return;
    }
    const { guild, page } = guildAndPage;

    await interaction.deferReply();

    try {
      const roster = await context.services.store.getServerRoster(guild.id);
      const rosterResult = await resolveGuildRoster(
        guild,
        roster,
        {
          correlationId: context.correlationId,
          command: interaction.commandName,
          guildId: guild.id,
          userId: interaction.user.id,
        },
        {
          noHandles: "No linked handles for current members.",
          noMembers: "No linked handles for current members.",
        }
      );
      if (rosterResult.status === "empty") {
        await interaction.editReply(rosterResult.message);
        return;
      }
      const filteredRoster = rosterResult.roster;

      const excludedCount = rosterResult.excludedCount;
      const totalPages = getTotalPages(filteredRoster.length, PAGE_SIZE);
      if (page > totalPages) {
        await interaction.editReply("Empty page.");
        return;
      }

      const paginationIds = buildPaginationIds("handles", interaction.id);
      const renderPage = async (pageNumber: number) => {
        const pageSlice = getPageSlice(filteredRoster, pageNumber, PAGE_SIZE);
        if (!pageSlice) {
          return null;
        }

        const lines = formatRatedRosterLines(
          filteredRoster,
          pageSlice.start,
          pageSlice.items.length
        );

        const embed = buildPageEmbed({
          title: "Linked handles",
          pageNumber,
          totalPages,
          fieldName: "Users",
          fieldValue: lines || "No entries.",
          color: EMBED_COLORS.info,
        });
        if (excludedCount > 0) {
          embed.setFooter({
            text: `${excludedCount} linked handle${excludedCount === 1 ? "" : "s"} excluded (not in server).`,
          });
        }
        return { embed };
      };

      await runPaginatedInteraction({
        interaction,
        paginationIds,
        initialPage: page,
        totalPages,
        renderPage,
        emptyMessage: "Empty page.",
      });
    } catch (error) {
      logCommandError(`Error in handles: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
