import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { addContestFilterOptions } from "../utils/commandOptions.js";
import { formatKeywordFilterClauses, parseKeywordFilters } from "../utils/contestFilters.js";
import {
  formatContestScopeLabel,
  parseContestScope,
} from "../utils/contestScope.js";
import { replyEphemeral, requireGuildIdEphemeral } from "../utils/interaction.js";
import { formatUpdatedAt } from "../utils/time.js";

import type { Command } from "./types.js";

function normalizeKeywordInput(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatScope(scope: string | null): string {
  if (!scope) {
    return "Official (default)";
  }
  return formatContestScopeLabel(parseContestScope(scope));
}

function buildFilterSummary(include: string | null, exclude: string | null): string {
  const filters = parseKeywordFilters(include, exclude);
  const parts = formatKeywordFilterClauses(filters, {
    include: "Include",
    exclude: "Exclude",
  });
  if (parts.length === 0) {
    return "None";
  }
  return parts.join(" • ");
}

export const contestFiltersCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestfilters")
    .setDescription("Configure default contest filters for /contests")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      addContestFilterOptions(
        subcommand.setName("set").setDescription("Set default contest filters"),
        "Default contest scope"
      )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show the current contest filters")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Clear default contest filters")
    ),
  adminOnly: true,
  async execute(interaction, context) {
    const guildId = await requireGuildIdEphemeral(
      interaction,
      "This command can only be used in a server."
    );
    if (!guildId) {
      return;
    }
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status") {
        const settings = await context.services.contestFilters.getSettings(guildId);
        if (!settings) {
          await replyEphemeral(interaction, "No default contest filters configured.");
          return;
        }
        const filterSummary = buildFilterSummary(
          settings.includeKeywords,
          settings.excludeKeywords
        );
        await replyEphemeral(
          interaction,
          `Default contest filters: ${filterSummary}. Scope: ${formatScope(
            settings.scope
          )}. Updated ${formatUpdatedAt(settings.updatedAt)}.`
        );
        return;
      }

      if (subcommand === "clear") {
        await context.services.contestFilters.clearSettings(guildId);
        await replyEphemeral(interaction, "Default contest filters cleared.");
        return;
      }

      const includeRaw = normalizeKeywordInput(interaction.options.getString("include"));
      const excludeRaw = normalizeKeywordInput(interaction.options.getString("exclude"));
      const scopeRaw = interaction.options.getString("scope");
      const scope = scopeRaw ? parseContestScope(scopeRaw) : null;

      if (!includeRaw && !excludeRaw && !scope) {
        await replyEphemeral(
          interaction,
          "Provide at least one of include, exclude, or scope to update defaults."
        );
        return;
      }

      await context.services.contestFilters.setSettings(guildId, {
        includeKeywords: includeRaw,
        excludeKeywords: excludeRaw,
        scope,
      });
      await replyEphemeral(
        interaction,
        `Default contest filters updated. Filters: ${buildFilterSummary(
          includeRaw,
          excludeRaw
        )}. Scope: ${formatScope(scope)}.`
      );
    } catch (error) {
      logCommandError("Contest filters command failed.", interaction, context.correlationId, {
        error: error instanceof Error ? error.message : String(error),
      });
      await replyEphemeral(interaction, "Failed to update contest filters.");
    }
  },
};
