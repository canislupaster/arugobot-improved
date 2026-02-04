import { ComponentType, EmbedBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import {
  buildPaginationIds,
  getPageSlice,
  getTotalPages,
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

  it("skips pagination controls when there is only one page", async () => {
    const response = {
      createMessageComponentCollector: jest.fn(),
    };
    const interaction = createInteraction({
      editReply: jest.fn().mockResolvedValue(response),
    });
    const renderPage = jest.fn().mockResolvedValue({
      embed: new EmbedBuilder().setTitle("Single"),
    });

    await runPaginatedInteraction({
      interaction,
      paginationIds: buildPaginationIds("test", interaction.id),
      initialPage: 1,
      totalPages: 1,
      renderPage,
    });

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds).toHaveLength(1);
    expect(payload.components).toEqual([]);
    expect(response.createMessageComponentCollector).not.toHaveBeenCalled();
  });
});

describe("getTotalPages", () => {
  it("returns at least one page", () => {
    expect(getTotalPages(0, 10)).toBe(1);
    expect(getTotalPages(1, 10)).toBe(1);
  });

  it("rounds up when items exceed the page size", () => {
    expect(getTotalPages(10, 10)).toBe(1);
    expect(getTotalPages(11, 10)).toBe(2);
  });
});

describe("getPageSlice", () => {
  it("returns the slice for a valid page", () => {
    const items = Array.from({ length: 12 }, (_, index) => index + 1);
    const slice = getPageSlice(items, 2, 5);
    expect(slice).not.toBeNull();
    expect(slice?.start).toBe(5);
    expect(slice?.items).toEqual([6, 7, 8, 9, 10]);
    expect(slice?.totalPages).toBe(3);
  });

  it("returns null for empty or out-of-range pages", () => {
    const items = Array.from({ length: 12 }, (_, index) => index + 1);
    expect(getPageSlice(items, 4, 5)).toBeNull();
    expect(getPageSlice([], 1, 5)).toBeNull();
  });
});
