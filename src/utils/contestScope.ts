import type { SlashCommandStringOption } from "discord.js";

import type { ContestService, ContestScope, ContestScopeFilter } from "../services/contests.js";

const DEFAULT_SCOPE: ContestScopeFilter = "official";
const CONTEST_UNAVAILABLE_MESSAGE =
  "Unable to reach Codeforces right now. Try again in a few minutes.";

export function parseContestScope(
  raw: string | null,
  fallback: ContestScopeFilter = DEFAULT_SCOPE
): ContestScopeFilter {
  if (raw === "gym" || raw === "all" || raw === "official") {
    return raw;
  }
  return fallback;
}

export async function refreshContestData(
  contests: Pick<ContestService, "refresh" | "getLastRefreshAt">,
  scope: ContestScopeFilter
): Promise<{ stale: boolean } | { error: string }> {
  if (scope === "all") {
    const results = await Promise.allSettled([
      contests.refresh(false, "official"),
      contests.refresh(false, "gym"),
    ]);
    const stale = results.some((result) => result.status === "rejected");
    if (contests.getLastRefreshAt("all") <= 0) {
      return { error: CONTEST_UNAVAILABLE_MESSAGE };
    }
    return { stale };
  }

  try {
    await contests.refresh(false, scope as ContestScope);
    return { stale: false };
  } catch {
    if (contests.getLastRefreshAt(scope) > 0) {
      return { stale: true };
    }
    return { error: CONTEST_UNAVAILABLE_MESSAGE };
  }
}

const CONTEST_SCOPE_CHOICES: Record<ContestScopeFilter, { name: string; value: ContestScopeFilter }> =
  {
    official: { name: "Official", value: "official" },
    gym: { name: "Gym", value: "gym" },
    all: { name: "All", value: "all" },
  };

const DEFAULT_SCOPE_ORDER: ContestScopeFilter[] = ["official", "gym", "all"];

export function formatContestScopeLabel(scope: ContestScopeFilter): string {
  return CONTEST_SCOPE_CHOICES[scope].name;
}

export function addContestScopeOption(
  option: SlashCommandStringOption,
  description = "Which contests to search",
  order: ContestScopeFilter[] = DEFAULT_SCOPE_ORDER
): SlashCommandStringOption {
  const choices = order.map((scope) => CONTEST_SCOPE_CHOICES[scope]);
  return option.setName("scope").setDescription(description).addChoices(...choices);
}
