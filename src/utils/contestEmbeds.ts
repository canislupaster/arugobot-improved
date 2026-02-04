import { EmbedBuilder } from "discord.js";

import type { ContestScopeFilter } from "../services/contests.js";

import { formatContestScopeLabel } from "./contestScope.js";

type ContestSummaryEmbedOptions = {
  title: string;
  days: number;
  scope: ContestScopeFilter;
  color?: number;
};

export function buildContestSummaryEmbedBase(
  options: ContestSummaryEmbedOptions
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(options.title)
    .setDescription(
      `Last ${options.days} days • Scope: ${formatContestScopeLabel(options.scope)}`
    );
  if (options.color !== undefined) {
    embed.setColor(options.color);
  }
  return embed;
}
