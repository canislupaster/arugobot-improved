import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Problem } from "../services/problems.js";
import { filterEntriesByGuildMembers } from "../utils/guildMembers.js";
import { addRatingRangeOptions, addTagOptions } from "../utils/commandOptions.js";
import {
  filterProblemsByRatingRanges,
  filterProblemsByTags,
  getProblemId,
  parseTagFilters,
  selectRandomProblems,
} from "../utils/problemSelection.js";
import { getColor } from "../utils/rating.js";
import { readRatingRangeOptions, resolveRatingRanges } from "../utils/ratingRanges.js";

import type { Command } from "./types.js";

const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;
const MAX_SUGGESTIONS = 10;
const MAX_HANDLES = 5;

type HandleResolution = {
  badHandles: string[];
  excludedIds: Set<string>;
  staleHandles: number;
  validHandles: string[];
};

export function parseHandles(raw: string): string[] {
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const handle of raw.split(/[,\s]+/)) {
    const trimmed = handle.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      handles.push(trimmed);
    }
  }
  return handles;
}

function buildSuggestionDescription(suggestions: Problem[]): string {
  const lines: string[] = [];
  for (const problem of suggestions) {
    const id = getProblemId(problem);
    lines.push(
      `- [${id}. ${problem.name}](https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index})`
    );
  }
  return lines.join("\n");
}

async function resolveHandlesFromInput(
  rawHandles: string,
  interaction: Parameters<Command["execute"]>[0],
  context: Parameters<Command["execute"]>[1]
): Promise<string[]> {
  let handles = parseHandles(rawHandles);
  if (handles.length === 0 && interaction.guild) {
    const linkedUsers = await context.services.store.getLinkedUsers(interaction.guild.id);
    const filtered = await filterEntriesByGuildMembers(interaction.guild, linkedUsers, {
      correlationId: context.correlationId,
      command: interaction.commandName,
      guildId: interaction.guild.id,
      userId: interaction.user.id,
    });
    handles = filtered.map((entry) => entry.handle);
  }
  return handles;
}

async function resolveHandleData(
  handles: string[],
  interaction: Parameters<Command["execute"]>[0],
  context: Parameters<Command["execute"]>[1]
): Promise<HandleResolution | null> {
  const validHandles: string[] = [];
  const badHandles: string[] = [];
  const excludedIds = new Set<string>();
  let staleHandles = 0;

  for (const handle of handles) {
    const handleInfo = await context.services.store.resolveHandle(handle);
    if (!handleInfo.exists) {
      badHandles.push(handle);
      continue;
    }

    const canonicalHandle = handleInfo.canonicalHandle ?? handle;
    const solvedResult = await context.services.store.getSolvedProblemsResult(canonicalHandle);
    if (!solvedResult) {
      await interaction.editReply("Something went wrong. Try again in a bit.");
      return null;
    }
    if (solvedResult.isStale) {
      staleHandles += 1;
    }
    validHandles.push(canonicalHandle);
    for (const solvedId of solvedResult.solved) {
      excludedIds.add(solvedId);
    }
  }

  return { badHandles, excludedIds, staleHandles, validHandles };
}

export const suggestCommand: Command = {
  data: addTagOptions(
    addRatingRangeOptions(
      new SlashCommandBuilder()
        .setName("suggest")
        .setDescription("Gives problems at a given rating that the handles have not solved")
    )
  ).addStringOption((option) =>
    option
      .setName("handles")
      .setDescription(`Space or comma separated list of Codeforces handles (max ${MAX_HANDLES})`)
  ),
  async execute(interaction, context) {
    const { rating, minRating: minRatingInput, maxRating: maxRatingInput, rangesRaw } =
      readRatingRangeOptions(interaction);
    const tagsRaw = interaction.options.getString("tags");
    const rawHandles = interaction.options.getString("handles") ?? "";
    const rangeResult = resolveRatingRanges({
      rating,
      minRating: minRatingInput,
      maxRating: maxRatingInput,
      rangesRaw,
      defaultMin: DEFAULT_MIN_RATING,
      defaultMax: DEFAULT_MAX_RATING,
    });
    if (rangeResult.error) {
      await interaction.reply({ content: rangeResult.error });
      return;
    }
    const { ranges } = rangeResult;

    const handles = await resolveHandlesFromInput(rawHandles, interaction, context);
    if (handles.length === 0) {
      await interaction.reply({
        content: "Provide handles or run this command in a server with linked users.",
      });
      return;
    }

    if (handles.length > MAX_HANDLES) {
      await interaction.reply({
        content: `Too many people (limit is ${MAX_HANDLES}).`,
      });
      return;
    }

    await interaction.deferReply();

    const problems = await context.services.problems.ensureProblemsLoaded();
    if (problems.length === 0) {
      await interaction.editReply("Try again in a bit.");
      return;
    }

    const tagFilters = parseTagFilters(tagsRaw);
    const ratedProblems = filterProblemsByRatingRanges(problems, ranges);
    const possibleProblems = filterProblemsByTags(ratedProblems, tagFilters);
    if (possibleProblems.length === 0) {
      await interaction.editReply("No problems found in that rating range and tag filter.");
      return;
    }
    const handleData = await resolveHandleData(handles, interaction, context);
    if (!handleData) {
      return;
    }
    const { badHandles, excludedIds, staleHandles, validHandles } = handleData;

    if (validHandles.length === 0) {
      await interaction.editReply("No valid handles found. Check your input and try again.");
      return;
    }

    const suggestions = selectRandomProblems(possibleProblems, excludedIds, MAX_SUGGESTIONS);
    const description = buildSuggestionDescription(
      suggestions.slice(0, Math.min(MAX_SUGGESTIONS, suggestions.length))
    );

    const minRating = Math.min(...ranges.map((range) => range.min));
    const maxRating = Math.max(...ranges.map((range) => range.max));
    const embed = new EmbedBuilder()
      .setTitle("Problem suggestions")
      .setDescription(description || "No suggestions found.")
      .setColor(getColor(Math.round((minRating + maxRating) / 2)));
    if (staleHandles > 0) {
      embed.setFooter({
        text: `Some solved lists may be stale (${staleHandles}/${validHandles.length}).`,
      });
    }

    await interaction.editReply({ embeds: [embed] });

    if (badHandles.length > 0) {
      await interaction.followUp({
        content: `Invalid handle(s) (ignored): ${badHandles.join(", ")}.`,
      });
    }
  },
};
