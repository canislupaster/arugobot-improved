import { ComponentType, EmbedBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import {
  buildPaginationIds,
  paginationTimeoutMs,
  runPaginatedInteraction,
} from "../../src/utils/pagination.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "interaction-1",
    user: { id: "user-1" },
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("runPaginatedInteraction", () => {
  it("returns the empty message when the page is missing", async () => {
    const interaction = createInteraction();
    const renderPage = jest.fn().mockResolvedValue(null);

    await runPaginatedInteraction({
      interaction,
      paginationIds: buildPaginationIds("test", interaction.id),
      initialPage: 1,
      totalPages: 1,
      renderPage,
    });

    expect(interaction.editReply).toHaveBeenCalledWith("Empty page.");
  });

  it("starts a collector when a page exists", async () => {
    const collector = { on: jest.fn() };
    const response = {
      createMessageComponentCollector: jest.fn().mockReturnValue(collector),
    };
    const interaction = createInteraction({
      editReply: jest.fn().mockResolvedValue(response),
    });
    const renderPage = jest.fn().mockResolvedValue({
      embed: new EmbedBuilder().setTitle("Page"),
    });

    await runPaginatedInteraction({
      interaction,
      paginationIds: buildPaginationIds("test", interaction.id),
      initialPage: 1,
      totalPages: 2,
      renderPage,
    });

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds).toHaveLength(1);
    expect(payload.components).toHaveLength(1);
    expect(response.createMessageComponentCollector).toHaveBeenCalledWith({
      componentType: ComponentType.Button,
      time: paginationTimeoutMs,
    });
    expect(collector.on).toHaveBeenCalledTimes(2);
  });
});
