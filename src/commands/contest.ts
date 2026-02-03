import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { buildContestEmbed, resolveContestOrReply } from "../utils/contestLookup.js";
import { addContestScopeOption, parseContestScope, refreshContestData } from "../utils/contestScope.js";

import type { Command } from "./types.js";

const MAX_MATCHES = 5;
const MATCH_FOOTER = "Use /contest with the contest ID for details.";
const STALE_FOOTER = "Showing cached data due to a temporary Codeforces error.";

function applyStaleFooter(embed: EmbedBuilder, stale: boolean): EmbedBuilder {
  if (stale) {
    embed.setFooter({ text: STALE_FOOTER });
  }
  return embed;
}

export const contestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contest")
    .setDescription("Shows details for a Codeforces contest")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Contest id, URL, name, or latest/next/ongoing")
        .setRequired(true)
    )
    .addStringOption((option) => addContestScopeOption(option)),
  async execute(interaction, context) {
    const queryRaw = interaction.options.getString("query", true).trim();
    const scope = parseContestScope(interaction.options.getString("scope"));
    await interaction.deferReply();

    const refreshResult = await refreshContestData(context.services.contests, scope);
    if ("error" in refreshResult) {
      await interaction.editReply(refreshResult.error);
      return;
    }
    const stale = refreshResult.stale;

    try {
      const lookup = await resolveContestOrReply(
        interaction,
        queryRaw,
        scope,
        context.services.contests,
        {
          maxMatches: MAX_MATCHES,
          footerText: MATCH_FOOTER,
          refreshWasStale: stale,
          allowUpcoming: true,
          allowOngoing: true,
          missingUpcomingMessage: "No upcoming contests found yet.",
          missingOngoingMessage: "No ongoing contests found right now.",
        }
      );
      if (lookup.status === "replied") {
        return;
      }

      const embed = buildContestEmbed({
        contest: lookup.contest,
        title: lookup.contest.name,
        scope,
        includeScope: scope !== "official",
      });
      applyStaleFooter(embed, stale);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in contest: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
