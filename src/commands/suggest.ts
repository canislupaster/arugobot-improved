import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import {
  filterProblemsByRatingRange,
  getProblemId,
  selectRandomProblems,
} from "../utils/problemSelection.js";
import { getColor } from "../utils/rating.js";

import type { Command } from "./types.js";

const MIN_RATING = 800;
const MAX_RATING = 3500;
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

function resolveRatingRange(
  rating: number | null,
  minRating: number | null,
  maxRating: number | null
): { minRating: number; maxRating: number; error?: string } {
  if (rating !== null && (minRating !== null || maxRating !== null)) {
    return { minRating: 0, maxRating: 0, error: "Use either rating or min/max, not both." };
  }

  if (rating === null && minRating === null && maxRating === null) {
    return {
      minRating: 0,
      maxRating: 0,
      error: "Provide a rating or a min/max rating range.",
    };
  }

  const resolvedMin = rating ?? minRating ?? MIN_RATING;
  const resolvedMax = rating ?? maxRating ?? MAX_RATING;

  if (resolvedMin < MIN_RATING || resolvedMax > MAX_RATING) {
    return {
      minRating: 0,
      maxRating: 0,
      error: `Ratings must be between ${MIN_RATING} and ${MAX_RATING}.`,
    };
  }
  if (resolvedMin > resolvedMax) {
    return { minRating: 0, maxRating: 0, error: "Minimum rating cannot exceed maximum rating." };
  }

  return { minRating: resolvedMin, maxRating: resolvedMax };
}

export const suggestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Gives problems at a given rating that the handles have not solved")
    .addIntegerOption((option) =>
      option.setName("rating").setDescription(`Exact problem rating (${MIN_RATING}-${MAX_RATING})`)
    )
    .addIntegerOption((option) =>
      option.setName("min_rating").setDescription(`Minimum rating (${MIN_RATING}-${MAX_RATING})`)
    )
    .addIntegerOption((option) =>
      option.setName("max_rating").setDescription(`Maximum rating (${MIN_RATING}-${MAX_RATING})`)
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
    const rawHandles = interaction.options.getString("handles") ?? "";
    const range = resolveRatingRange(rating, minRatingOption, maxRatingOption);
    if (range.error) {
      await interaction.reply({ content: range.error, ephemeral: true });
      return;
    }
    const { minRating, maxRating } = range;

    let handles = parseHandles(rawHandles);
    if (handles.length === 0 && interaction.guild) {
      handles = await context.services.store.getHandlesForServer(interaction.guild.id);
    }
    if (handles.length === 0) {
      await interaction.reply({
        content: "Provide handles or run this command in a server with linked users.",
        ephemeral: true,
      });
      return;
    }

    if (handles.length > MAX_HANDLES) {
      await interaction.reply({
        content: `Too many people (limit is ${MAX_HANDLES}).`,
        ephemeral: true,
      });
      return;
    }

    const problems = await context.services.problems.ensureProblemsLoaded();
    if (problems.length === 0) {
      await interaction.reply({ content: "Try again in a bit.", ephemeral: true });
      return;
    }

    const possibleProblems = filterProblemsByRatingRange(problems, minRating, maxRating);
    if (possibleProblems.length === 0) {
      await interaction.reply({
        content: "No problems found in that rating range.",
        ephemeral: true,
      });
      return;
    }
    const validHandles: string[] = [];
    const badHandles: string[] = [];
    const excludedIds = new Set<string>();

    for (const handle of handles) {
      const handleInfo = await context.services.store.resolveHandle(handle);
      if (handleInfo.exists) {
        const canonicalHandle = handleInfo.canonicalHandle ?? handle;
        const solved = await context.services.store.getSolvedProblems(canonicalHandle);
        if (!solved) {
          await interaction.reply({
            content: "Something went wrong. Try again in a bit.",
            ephemeral: true,
          });
          return;
        }
        validHandles.push(canonicalHandle);
        for (const solvedId of solved) {
          excludedIds.add(solvedId);
        }
      } else {
        badHandles.push(handle);
      }
    }

    if (validHandles.length === 0) {
      await interaction.reply({
        content: "No valid handles found. Check your input and try again.",
        ephemeral: true,
      });
      return;
    }

    if (badHandles.length > 0) {
      await interaction.reply({
        content: `Invalid handle(s) (will be ignored): ${badHandles.join(", ")}.`,
        ephemeral: true,
      });
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

    const embed = new EmbedBuilder()
      .setTitle("Problem suggestions")
      .setDescription(description || "No suggestions found.")
      .setColor(getColor(Math.round((minRating + maxRating) / 2)));

    if (badHandles.length > 0) {
      await interaction.followUp({ embeds: [embed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [embed] });
    }
  },
};
