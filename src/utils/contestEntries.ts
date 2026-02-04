import { EmbedBuilder } from "discord.js";

export type RankedEntry = {
  rank: number;
};

export function formatTargetLabel(label: string, handle: string): string {
  if (label.startsWith("<@")) {
    return `${label} (${handle})`;
  }
  return label;
}

export function buildRankedLines<T extends RankedEntry>(
  entries: T[],
  limit: number,
  formatLine: (entry: T) => string
): { lines: string[]; truncated: boolean; total: number } {
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  const lines = sorted.slice(0, limit).map(formatLine);
  return { lines, truncated: entries.length > limit, total: entries.length };
}

export function addRankedLinesField<T extends RankedEntry>(options: {
  embed: EmbedBuilder;
  entries: T[];
  limit: number;
  fieldName: string;
  formatLine: (entry: T) => string;
  footerNotes: string[];
}): void {
  const { lines, truncated, total } = buildRankedLines(
    options.entries,
    options.limit,
    options.formatLine
  );
  options.embed.addFields({ name: options.fieldName, value: lines.join("\n"), inline: false });
  if (truncated) {
    options.footerNotes.push(`Showing top ${options.limit} of ${total} entries.`);
  }
}
