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
