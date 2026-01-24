export type KeywordFilters = {
  includeKeywords: string[];
  excludeKeywords: string[];
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

export function serializeKeywords(keywords: string[]): string {
  return keywords.join(", ");
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
