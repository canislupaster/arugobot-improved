import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";
import { resolveBoundedIntegerOption } from "../utils/interaction.js";
import {
  buildPageEmbed,
  buildPaginationIds,
  runPaginatedInteraction,
} from "../utils/pagination.js";

import type { Command } from "./types.js";

const PAGE_SIZE = 10;

const buildRosterLines = (
  roster: Array<{ userId: string; handle: string; rating: number }>,
  start: number,
  count: number
) =>
  roster
    .slice(start, start + count)
    .map(
      (entry, index) =>
        `${start + index + 1}. <@${entry.userId}> - ${entry.handle} (${entry.rating})`
    )
    .join("\n");

export const handlesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("handles")
    .setDescription("Lists linked Codeforces handles for this server")
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
    const pageResult = resolveBoundedIntegerOption(interaction, {
      name: "page",
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      defaultValue: 1,
      errorMessage: "Invalid page.",
    });
    if ("error" in pageResult) {
      await interaction.reply({ content: pageResult.error });
      return;
    }
    const page = pageResult.value;

    await interaction.deferReply();

    try {
      const roster = await context.services.store.getServerRoster(interaction.guild.id);
      const filteredRoster = await filterEntriesByGuildMembers(interaction.guild, roster, {
        correlationId: context.correlationId,
        command: interaction.commandName,
        guildId: interaction.guild.id,
        userId: interaction.user.id,
      });
      if (filteredRoster.length === 0) {
        await interaction.editReply("No linked handles for current members.");
        return;
      }

      const totalPages = Math.max(1, Math.ceil(filteredRoster.length / PAGE_SIZE));
      if (page > totalPages) {
        await interaction.editReply("Empty page.");
        return;
      }

      const paginationIds = buildPaginationIds("handles", interaction.id);
      const renderPage = async (pageNumber: number) => {
        const start = (pageNumber - 1) * PAGE_SIZE;
        if (start >= filteredRoster.length) {
          return null;
        }

        const lines = buildRosterLines(filteredRoster, start, PAGE_SIZE);

        const embed = buildPageEmbed({
          title: "Linked handles",
          pageNumber,
          totalPages,
          fieldName: "Users",
          fieldValue: lines || "No entries.",
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
        emptyMessage: "Empty page.",
      });
    } catch (error) {
      logCommandError(`Error in handles: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
