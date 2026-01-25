import { ComponentType, EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";
import {
  buildPaginationIds,
  buildPaginationRow,
  paginationTimeoutMs,
} from "../utils/pagination.js";

import type { Command } from "./types.js";
import { EMBED_COLORS } from "../utils/embedColors.js";

const PAGE_SIZE = 10;

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
    const page = interaction.options.getInteger("page") ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      await interaction.reply({ content: "Invalid page." });
      return;
    }

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
      const renderPage = (pageNumber: number) => {
        const start = (pageNumber - 1) * PAGE_SIZE;
        if (start >= filteredRoster.length) {
          return null;
        }

        const lines = filteredRoster
          .slice(start, start + PAGE_SIZE)
          .map(
            (entry, index) =>
              `${start + index + 1}. <@${entry.userId}> - ${entry.handle} (${entry.rating})`
          )
          .join("\n");

        const embed = new EmbedBuilder()
          .setTitle("Linked handles")
          .setDescription(`Page ${pageNumber} of ${totalPages}`)
          .setColor(EMBED_COLORS.info)
          .addFields({ name: "Users", value: lines || "No entries.", inline: false });
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
      logCommandError(`Error in handles: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
