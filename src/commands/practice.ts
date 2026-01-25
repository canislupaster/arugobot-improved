import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { getProblemId } from "../utils/problemSelection.js";
import { getColor } from "../utils/rating.js";
import { resolveRatingRanges } from "../utils/ratingRanges.js";

import type { Command } from "./types.js";

const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;
const PRACTICE_SUGGESTION_RETENTION_DAYS = 14;

function buildProblemLink(contestId: number, index: string, name: string): string {
  return `[${index}. ${name}](https://codeforces.com/problemset/problem/${contestId}/${index})`;
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
        if (!ratingInputProvided && preferences?.ratingRanges.length) {
          ratingRanges = preferences.ratingRanges;
        }
        if (!tags && preferences?.tags) {
          tags = preferences.tags;
        }
      }
      let handle = "";
      let historyUserId: string | null = null;

      if (handleInput) {
        const handleInfo = await context.services.store.resolveHandle(handleInput);
        if (!handleInfo.exists) {
          await interaction.editReply("Invalid handle.");
          return;
        }
        handle = handleInfo.canonicalHandle ?? handleInput;
        if (interaction.guild) {
          historyUserId = await context.services.store.getUserIdByHandle(
            interaction.guild.id,
            handle
          );
        }
      } else {
        const guildId = interaction.guild?.id ?? "";
        const linkedHandle = await context.services.store.getHandle(guildId, targetUser.id);
        if (!linkedHandle) {
          await interaction.editReply("Handle not linked.");
          return;
        }
        handle = linkedHandle;
        historyUserId = targetUser.id;
      }

      const excludedIds = new Set<string>();
      if (interaction.guild && historyUserId) {
        const guildId = interaction.guild.id;
        const history = await context.services.store.getHistoryList(guildId, historyUserId);
        for (const problemId of history) {
          excludedIds.add(problemId);
        }

        const cutoffIso = new Date(
          Date.now() - PRACTICE_SUGGESTION_RETENTION_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();
        await context.services.store.cleanupPracticeSuggestions(cutoffIso);
        const recentSuggestions = await context.services.store.getRecentPracticeSuggestions(
          guildId,
          historyUserId,
          cutoffIso
        );
        for (const problemId of recentSuggestions) {
          excludedIds.add(problemId);
        }
      }

      const suggestion = await context.services.practiceSuggestions.suggestProblem(handle, {
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
      if (interaction.guild && historyUserId) {
        await context.services.store.recordPracticeSuggestion(
          interaction.guild.id,
          historyUserId,
          getProblemId(problem)
        );
      }
      const embed = new EmbedBuilder()
        .setTitle(`Practice suggestion for ${handleInput ? handle : targetUser.username}`)
        .setColor(problem.rating ? getColor(problem.rating) : 0x3498db)
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
          { name: "Handle", value: handle, inline: true },
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
