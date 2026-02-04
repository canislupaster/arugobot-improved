import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";

export const paginationTimeoutMs = 60 * 1000;

export type PaginationIds = {
  prev: string;
  next: string;
};

export function buildPaginationIds(prefix: string, interactionId: string): PaginationIds {
  return {
    prev: `${prefix}_prev_${interactionId}`,
    next: `${prefix}_next_${interactionId}`,
  };
}

export function buildPaginationRow(
  ids: PaginationIds,
  currentPage: number,
  totalPages: number,
  disableAll = false
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const disablePrev = disableAll || currentPage <= 1;
  const disableNext = disableAll || currentPage >= totalPages;
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.prev)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disablePrev),
    new ButtonBuilder()
      .setCustomId(ids.next)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableNext)
  );
}

export type PaginatedRender = {
  embed: EmbedBuilder;
};

export type PageEmbedOptions = {
  title: string;
  pageNumber: number;
  totalPages: number;
  fieldName: string;
  fieldValue: string;
  color?: number;
};

export function buildPageEmbed(options: PageEmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(options.title)
    .setDescription(`Page ${options.pageNumber} of ${options.totalPages}`)
    .addFields({ name: options.fieldName, value: options.fieldValue, inline: false });
  if (options.color !== undefined) {
    embed.setColor(options.color);
  }
  return embed;
}

export async function runPaginatedInteraction(options: {
  interaction: ChatInputCommandInteraction;
  paginationIds: PaginationIds;
  initialPage: number;
  totalPages: number;
  renderPage: (pageNumber: number) => Promise<PaginatedRender | null>;
  emptyMessage?: string;
}): Promise<void> {
  const {
    interaction,
    paginationIds,
    initialPage,
    totalPages,
    renderPage,
    emptyMessage = "Empty page.",
  } = options;
  let currentPage = initialPage;
  const initial = await renderPage(currentPage);
  if (!initial) {
    await interaction.editReply(emptyMessage);
    return;
  }
  if (totalPages <= 1) {
    await interaction.editReply({
      embeds: [initial.embed],
      components: [],
    });
    return;
  }
  const response = await interaction.editReply({
    embeds: [initial.embed],
    components: [buildPaginationRow(paginationIds, currentPage, totalPages)],
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
    await interaction.editReply({
      embeds: [updated.embed],
      components: [buildPaginationRow(paginationIds, currentPage, totalPages)],
    });
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
