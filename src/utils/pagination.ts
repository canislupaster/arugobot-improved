import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
