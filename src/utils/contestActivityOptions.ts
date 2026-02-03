import type { ContestScopeFilter } from "../services/contests.js";

import { parseContestScope } from "./contestScope.js";
import { resolveBoundedIntegerOption } from "./interaction.js";

type ContestActivityOptions =
  | { status: "ok"; days: number; limit: number; scope: ContestScopeFilter }
  | { status: "error"; message: string };

type ContestActivityOptionConfig = {
  defaultDays: number;
  minDays: number;
  maxDays: number;
  defaultLimit: number;
  maxLimit: number;
  defaultScope: ContestScopeFilter;
  daysErrorMessage: string;
  limitErrorMessage: string;
};

type IntegerOptionInteraction = {
  options: {
    getInteger: (name: string) => number | null;
    getString: (name: string) => string | null;
  };
};

export function resolveContestActivityOptions(
  interaction: IntegerOptionInteraction,
  config: ContestActivityOptionConfig
): ContestActivityOptions {
  const scope = parseContestScope(interaction.options.getString("scope"), config.defaultScope);
  const daysResult = resolveBoundedIntegerOption(interaction, {
    name: "days",
    min: config.minDays,
    max: config.maxDays,
    defaultValue: config.defaultDays,
    errorMessage: config.daysErrorMessage,
  });
  if ("error" in daysResult) {
    return { status: "error", message: daysResult.error };
  }

  const limitResult = resolveBoundedIntegerOption(interaction, {
    name: "limit",
    min: 1,
    max: config.maxLimit,
    defaultValue: config.defaultLimit,
    errorMessage: config.limitErrorMessage,
  });
  if ("error" in limitResult) {
    return { status: "error", message: limitResult.error };
  }

  return {
    status: "ok",
    days: daysResult.value,
    limit: limitResult.value,
    scope,
  };
}
