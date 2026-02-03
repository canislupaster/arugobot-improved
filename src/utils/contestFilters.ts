export type KeywordFilters = {
  includeKeywords: string[];
  excludeKeywords: string[];
};

export type KeywordFilterClauseLabels = {
  include: string;
  exclude: string;
};

export type ContestReminderPreset = "div2" | "div3" | "div4" | "educational";

type ContestReminderPresetConfig = KeywordFilters & { label: string };

function buildPreset(
  label: string,
  includeKeywords: string[],
  excludeKeywords: string[] = []
): ContestReminderPresetConfig {
  return { label, includeKeywords, excludeKeywords };
}

const CONTEST_REMINDER_PRESETS: Record<ContestReminderPreset, ContestReminderPresetConfig> = {
  div2: buildPreset("Div 2", ["div. 2", "div.2", "div 2"]),
  div3: buildPreset("Div 3", ["div. 3", "div.3", "div 3"]),
  div4: buildPreset("Div 4", ["div. 4", "div.4", "div 4"]),
  educational: buildPreset("Educational", ["educational"]),
};

function normalizeKeywords(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const token of raw.split(",")) {
    const trimmed = token.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    keywords.push(trimmed);
  }
  return keywords;
}

export function parseKeywordFilters(rawInclude?: string | null, rawExclude?: string | null) {
  return {
    includeKeywords: normalizeKeywords(rawInclude),
    excludeKeywords: normalizeKeywords(rawExclude),
  };
}

export function getContestReminderPreset(
  preset: ContestReminderPreset
): ContestReminderPresetConfig {
  return CONTEST_REMINDER_PRESETS[preset];
}

export function listContestReminderPresets(): Array<{
  name: string;
  value: ContestReminderPreset;
}> {
  return Object.entries(CONTEST_REMINDER_PRESETS).map(([key, config]) => ({
    name: config.label,
    value: key as ContestReminderPreset,
  }));
}

export function serializeKeywords(keywords: string[]): string {
  return keywords.join(", ");
}

export function formatKeywordFilterClauses(
  filters: KeywordFilters,
  labels: KeywordFilterClauseLabels = { include: "include", exclude: "exclude" }
): string[] {
  const parts: string[] = [];
  if (filters.includeKeywords.length > 0) {
    parts.push(`${labels.include}: ${filters.includeKeywords.join(", ")}`);
  }
  if (filters.excludeKeywords.length > 0) {
    parts.push(`${labels.exclude}: ${filters.excludeKeywords.join(", ")}`);
  }
  return parts;
}

export function filterContestsByKeywords<T extends { name: string }>(
  contests: T[],
  filters: KeywordFilters
): T[] {
  if (filters.includeKeywords.length === 0 && filters.excludeKeywords.length === 0) {
    return contests.slice();
  }
  return contests.filter((contest) => {
    const name = contest.name.toLowerCase();
    if (
      filters.excludeKeywords.length > 0 &&
      filters.excludeKeywords.some((keyword) => name.includes(keyword))
    ) {
      return false;
    }
    if (filters.includeKeywords.length === 0) {
      return true;
    }
    return filters.includeKeywords.some((keyword) => name.includes(keyword));
  });
}
