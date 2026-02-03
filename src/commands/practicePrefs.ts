import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";

import { addRatingRangeOptions, addTagOptions } from "../utils/commandOptions.js";
import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import {
  formatRatingRangesWithDefaults,
  readRatingRangeOptions,
  resolveRatingRanges,
  type RatingRange,
} from "../utils/ratingRanges.js";

import type { Command } from "./types.js";

const DEFAULT_MIN_RATING = 800;
const DEFAULT_MAX_RATING = 3500;

export const practicePrefsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("practiceprefs")
    .setDescription("Manage your default practice filters")
    .addSubcommand((subcommand) =>
      addTagOptions(
        addRatingRangeOptions(
          subcommand.setName("set").setDescription("Save your default practice filters")
        )
      )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show your current practice filters")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Clear your saved practice filters")
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status") {
        const preferences = await context.services.store.getPracticePreferences(guildId, userId);
        if (!preferences) {
          await interaction.reply({
            content: "No practice preferences saved yet. Use /practiceprefs set to configure.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle("Practice preferences")
          .setColor(EMBED_COLORS.success)
          .addFields(
            {
              name: "Ranges",
              value: formatRatingRangesWithDefaults(
                preferences.ratingRanges,
                DEFAULT_MIN_RATING,
                DEFAULT_MAX_RATING
              ),
              inline: false,
            },
            {
              name: "Tags",
              value: preferences.tags.trim() ? preferences.tags.trim() : "None",
              inline: false,
            }
          )
          .setFooter({ text: `Updated ${preferences.updatedAt}` });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (subcommand === "clear") {
        const removed = await context.services.store.clearPracticePreferences(guildId, userId);
        await interaction.reply({
          content: removed
            ? "Practice preferences cleared."
            : "No saved practice preferences to clear.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (subcommand === "set") {
        const { rating, minRating, maxRating, rangesRaw } = readRatingRangeOptions(interaction);
        const tagsRaw = interaction.options.getString("tags");

        const ratingInputProvided =
          rating !== null || minRating !== null || maxRating !== null || rangesRaw !== null;
        const tagsInputProvided = tagsRaw !== null;

        if (!ratingInputProvided && !tagsInputProvided) {
          await interaction.reply({
            content: "Provide rating ranges or tags to update your preferences.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const existing = await context.services.store.getPracticePreferences(guildId, userId);

        let ratingRanges: RatingRange[] = existing?.ratingRanges ?? [];
        if (ratingInputProvided) {
          const rangeResult = resolveRatingRanges({
            rating,
            minRating,
            maxRating,
            rangesRaw,
            defaultMin: DEFAULT_MIN_RATING,
            defaultMax: DEFAULT_MAX_RATING,
          });
          if (rangeResult.error) {
            await interaction.reply({ content: rangeResult.error, flags: MessageFlags.Ephemeral });
            return;
          }
          ratingRanges = rangeResult.ranges;
        }
        if (ratingRanges.length === 0) {
          ratingRanges = [{ min: DEFAULT_MIN_RATING, max: DEFAULT_MAX_RATING }];
        }

        let tags = existing?.tags ?? "";
        if (tagsInputProvided) {
          tags = tagsRaw?.trim() ?? "";
        }

        await context.services.store.setPracticePreferences(guildId, userId, ratingRanges, tags);
        await interaction.reply({
          content: `Practice preferences updated. Ranges: ${formatRatingRangesWithDefaults(
            ratingRanges,
            DEFAULT_MIN_RATING,
            DEFAULT_MAX_RATING
          )}. Tags: ${tags.trim() ? tags.trim() : "None"}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (error) {
      logCommandError(
        `Practice preferences failed: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.reply({ content: "Something went wrong.", flags: MessageFlags.Ephemeral });
    }
  },
};
