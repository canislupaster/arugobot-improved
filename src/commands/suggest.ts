import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import {
  filterProblemsByRatingRanges,
  filterProblemsByTags,
  getProblemId,
  parseTagFilters,
  selectRandomProblems,
} from "../utils/problemSelection.js";
import { getColor } from "../utils/rating.js";
import { resolveRatingRanges } from "../utils/ratingRanges.js";

import type { Command } from "./types.js";

const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;
const MAX_SUGGESTIONS = 10;
const MAX_HANDLES = 5;

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

export const suggestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Gives problems at a given rating that the handles have not solved")
    .addIntegerOption((option) =>
      option.setName("rating").setDescription("Exact problem rating").setMinValue(0)
    )
    .addIntegerOption((option) =>
      option.setName("min_rating").setDescription("Minimum rating").setMinValue(0)
    )
    .addIntegerOption((option) =>
      option.setName("max_rating").setDescription("Maximum rating").setMinValue(0)
    )
    .addStringOption((option) =>
      option.setName("ranges").setDescription("Rating ranges (e.g. 800-1200, 1400, 1600-1800)")
    )
    .addStringOption((option) =>
      option.setName("tags").setDescription("Problem tags (e.g. dp, greedy, -math)")
    )
    .addStringOption((option) =>
      option
        .setName("handles")
        .setDescription(`Space or comma separated list of Codeforces handles (max ${MAX_HANDLES})`)
    ),
  async execute(interaction, context) {
    const rating = interaction.options.getInteger("rating");
    const minRatingOption = interaction.options.getInteger("min_rating");
    const maxRatingOption = interaction.options.getInteger("max_rating");
    const rangesRaw = interaction.options.getString("ranges");
    const tagsRaw = interaction.options.getString("tags");
    const rawHandles = interaction.options.getString("handles") ?? "";
    const rangeResult = resolveRatingRanges({
      rating,
      minRating: minRatingOption,
      maxRating: maxRatingOption,
      rangesRaw,
      defaultMin: DEFAULT_MIN_RATING,
      defaultMax: DEFAULT_MAX_RATING,
    });
    if (rangeResult.error) {
      await interaction.reply({ content: rangeResult.error });
      return;
    }
    const ranges = rangeResult.ranges;

    let handles = parseHandles(rawHandles);
    if (handles.length === 0 && interaction.guild) {
      handles = await context.services.store.getHandlesForServer(interaction.guild.id);
    }
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
    const validHandles: string[] = [];
    const badHandles: string[] = [];
    const excludedIds = new Set<string>();
    let staleHandles = 0;

    for (const handle of handles) {
      const handleInfo = await context.services.store.resolveHandle(handle);
      if (handleInfo.exists) {
        const canonicalHandle = handleInfo.canonicalHandle ?? handle;
        const solvedResult = await context.services.store.getSolvedProblemsResult(canonicalHandle);
        if (!solvedResult) {
          await interaction.editReply("Something went wrong. Try again in a bit.");
          return;
        }
        if (solvedResult.isStale) {
          staleHandles += 1;
        }
        validHandles.push(canonicalHandle);
        for (const solvedId of solvedResult.solved) {
          excludedIds.add(solvedId);
        }
      } else {
        badHandles.push(handle);
      }
    }

    if (validHandles.length === 0) {
      await interaction.editReply("No valid handles found. Check your input and try again.");
      return;
    }

    const suggestions = selectRandomProblems(possibleProblems, excludedIds, MAX_SUGGESTIONS);

    let description = "";
    for (let i = 0; i < Math.min(MAX_SUGGESTIONS, suggestions.length); i += 1) {
      const problem = suggestions[i];
      const id = getProblemId(problem);
      description += `- [${id}. ${problem.name}](https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index})`;
      if (i !== Math.min(MAX_SUGGESTIONS, suggestions.length) - 1) {
        description += "\n";
      }
    }

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
