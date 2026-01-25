import { EmbedBuilder, SlashCommandBuilder, type User } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { getProblemId } from "../utils/problemSelection.js";
import { getColor } from "../utils/rating.js";
import { resolveRatingRanges } from "../utils/ratingRanges.js";

import type { CommandContext } from "../types/commandContext.js";
import type { Command } from "./types.js";

const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;
const PRACTICE_SUGGESTION_RETENTION_DAYS = 14;

type PracticeTarget =
  | {
      status: "ok";
      handle: string;
      historyUserId: string | null;
      displayName: string;
    }
  | { status: "invalid_handle" | "missing_handle" };

function buildProblemLink(contestId: number, index: string, name: string): string {
  return `[${index}. ${name}](https://codeforces.com/problemset/problem/${contestId}/${index})`;
}

function applyPreferenceFilters(
  ratingRanges: Array<{ min: number; max: number }>,
  tags: string,
  ratingInputProvided: boolean,
  preferences: { ratingRanges: Array<{ min: number; max: number }>; tags: string } | null
) {
  const nextRanges =
    !ratingInputProvided && preferences?.ratingRanges.length
      ? preferences.ratingRanges
      : ratingRanges;
  const nextTags = !tags && preferences?.tags ? preferences.tags : tags;
  return { ratingRanges: nextRanges, tags: nextTags };
}

async function resolvePracticeTarget(
  handleInput: string,
  targetUser: User,
  guildId: string | null,
  store: CommandContext["services"]["store"]
): Promise<PracticeTarget> {
  if (handleInput) {
    const handleInfo = await store.resolveHandle(handleInput);
    if (!handleInfo.exists) {
      return { status: "invalid_handle" };
    }
    const canonicalHandle = handleInfo.canonicalHandle ?? handleInput;
    const historyUserId = guildId
      ? await store.getUserIdByHandle(guildId, canonicalHandle)
      : null;
    return {
      status: "ok",
      handle: canonicalHandle,
      historyUserId,
      displayName: canonicalHandle,
    };
  }

  if (!guildId) {
    return { status: "missing_handle" };
  }

  const linkedHandle = await store.getHandle(guildId, targetUser.id);
  if (!linkedHandle) {
    return { status: "missing_handle" };
  }

  return {
    status: "ok",
    handle: linkedHandle,
    historyUserId: targetUser.id,
    displayName: targetUser.username,
  };
}

async function collectExcludedProblemIds(
  guildId: string | null,
  historyUserId: string | null,
  store: CommandContext["services"]["store"]
) {
  const excludedIds = new Set<string>();
  if (!guildId || !historyUserId) {
    return excludedIds;
  }

  const history = await store.getHistoryList(guildId, historyUserId);
  for (const problemId of history) {
    excludedIds.add(problemId);
  }

  const cutoffIso = new Date(
    Date.now() - PRACTICE_SUGGESTION_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  await store.cleanupPracticeSuggestions(cutoffIso);
  const recentSuggestions = await store.getRecentPracticeSuggestions(
    guildId,
    historyUserId,
    cutoffIso
  );
  for (const problemId of recentSuggestions) {
    excludedIds.add(problemId);
  }

  return excludedIds;
}

export const practiceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("practice")
    .setDescription("Suggests a practice problem for a user or handle")
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
    .addUserOption((option) => option.setName("user").setDescription("User to target"))
    .addStringOption((option) =>
      option.setName("handle").setDescription("Codeforces handle to target")
    ),
  async execute(interaction, context) {
    const handleInput = interaction.options.getString("handle")?.trim() ?? "";
    const userOption = interaction.options.getUser("user");
    const tagsRaw = interaction.options.getString("tags");
    const tagsInput = tagsRaw?.trim() ?? "";
    const rating = interaction.options.getInteger("rating");
    const minRatingOption = interaction.options.getInteger("min_rating");
    const maxRatingOption = interaction.options.getInteger("max_rating");
    const rangesRaw = interaction.options.getString("ranges");
    const ratingInputProvided =
      rating !== null || minRatingOption !== null || maxRatingOption !== null || rangesRaw !== null;

    if (handleInput && userOption) {
      await interaction.reply({
        content: "Provide either a handle or a user, not both.",
      });
      return;
    }

    if (!interaction.guild && !handleInput) {
      await interaction.reply({
        content: "Run this command in a server or provide a handle.",
      });
      return;
    }

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

    await interaction.deferReply();

    try {
      const targetUser = userOption ?? interaction.user;
      let tags = tagsInput;
      let ratingRanges = rangeResult.ranges;
      if (interaction.guild && !handleInput) {
        const preferences = await context.services.store.getPracticePreferences(
          interaction.guild.id,
          targetUser.id
        );
        ({ ratingRanges, tags } = applyPreferenceFilters(
          ratingRanges,
          tags,
          ratingInputProvided,
          preferences
        ));
      }

      const target = await resolvePracticeTarget(
        handleInput,
        targetUser,
        interaction.guild?.id ?? null,
        context.services.store
      );
      if (target.status !== "ok") {
        await interaction.editReply(
          target.status === "invalid_handle" ? "Invalid handle." : "Handle not linked."
        );
        return;
      }

      const excludedIds = await collectExcludedProblemIds(
        interaction.guild?.id ?? null,
        target.historyUserId,
        context.services.store
      );

      const suggestion = await context.services.practiceSuggestions.suggestProblem(target.handle, {
        ratingRanges,
        tags,
        excludedIds,
      });

      if (suggestion.status === "no_problems") {
        await interaction.editReply("Problem cache not ready yet. Try again in a bit.");
        return;
      }
      if (suggestion.status === "no_solved") {
        await interaction.editReply("Unable to fetch solved problems right now.");
        return;
      }
      if (suggestion.status === "no_candidates") {
        await interaction.editReply(
          "No unsolved problems found for that rating range and tag filter."
        );
        return;
      }

      const problem = suggestion.problem;
      if (interaction.guild && target.historyUserId) {
        await context.services.store.recordPracticeSuggestion(
          interaction.guild.id,
          target.historyUserId,
          getProblemId(problem)
        );
      }
      const embed = new EmbedBuilder()
        .setTitle(`Practice suggestion for ${target.displayName}`)
        .setColor(problem.rating ? getColor(problem.rating) : EMBED_COLORS.info)
        .addFields(
          {
            name: "Problem",
            value: buildProblemLink(problem.contestId, problem.index, problem.name),
            inline: false,
          },
          {
            name: "Rating",
            value: problem.rating ? String(problem.rating) : "Unrated",
            inline: true,
          },
          { name: "Handle", value: target.handle, inline: true },
          {
            name: "Tags",
            value: problem.tags.length > 0 ? problem.tags.join(", ") : "None",
            inline: false,
          }
        );

      const notes = [
        `Candidates: ${suggestion.candidateCount}`,
        `Excluded: ${suggestion.excludedCount}`,
      ];
      if (suggestion.isStale) {
        notes.push("Solved list may be stale");
      }
      embed.setFooter({ text: notes.join(" • ") });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in practice: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
