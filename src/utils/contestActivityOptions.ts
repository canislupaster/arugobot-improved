import type {
  Guild,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";

import type { ContestScopeFilter } from "../services/contests.js";

import { parseContestScope } from "./contestScope.js";
import { addContestScopeOption } from "./contestScope.js";
import { resolveBoundedIntegerOption } from "./interaction.js";
import type { RosterEntry, RosterMessages } from "./roster.js";
import { resolveGuildRosterFromStoreOrReply } from "./roster.js";

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

export const CONTEST_ACTIVITY_DEFAULTS = {
  defaultDays: 90,
  minDays: 1,
  maxDays: 365,
  defaultLimit: 5,
  maxLimit: 10,
  defaultScope: "all" as ContestScopeFilter,
};

export function addContestActivityCommandOptions(
  builder: SlashCommandBuilder,
  options: { limitDescription: string; scopeDescription?: string }
): SlashCommandOptionsOnlyBuilder {
  return builder
    .addIntegerOption((option) =>
      option
        .setName("days")
        .setDescription(
          `Lookback window (${CONTEST_ACTIVITY_DEFAULTS.minDays}-${CONTEST_ACTIVITY_DEFAULTS.maxDays} days)`
        )
        .setMinValue(CONTEST_ACTIVITY_DEFAULTS.minDays)
        .setMaxValue(CONTEST_ACTIVITY_DEFAULTS.maxDays)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(options.limitDescription)
        .setMinValue(1)
        .setMaxValue(CONTEST_ACTIVITY_DEFAULTS.maxLimit)
    )
    .addStringOption((option) =>
      addContestScopeOption(
        option,
        options.scopeDescription ?? "Which contests to include",
        ["all", "official", "gym"]
      )
    );
}

export function buildContestActivityOptionConfig(messages: {
  daysErrorMessage: string;
  limitErrorMessage: string;
}): ContestActivityOptionConfig {
  return {
    ...CONTEST_ACTIVITY_DEFAULTS,
    daysErrorMessage: messages.daysErrorMessage,
    limitErrorMessage: messages.limitErrorMessage,
  };
}

type IntegerOptionInteraction = {
  options: {
    getInteger: (name: string) => number | null;
    getString: (name: string) => string | null;
  };
};

type ContestActivityReplyInteraction = IntegerOptionInteraction & {
  reply: (options: { content: string }) => Promise<unknown>;
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

export async function resolveContestActivityOptionsOrReply(
  interaction: ContestActivityReplyInteraction,
  config: ContestActivityOptionConfig
): Promise<
  | { status: "ok"; days: number; limit: number; scope: ContestScopeFilter }
  | { status: "replied" }
> {
  const result = resolveContestActivityOptions(interaction, config);
  if (result.status === "error") {
    await interaction.reply({ content: result.message });
    return { status: "replied" };
  }
  return result;
}

type ContestActivityContextInteraction<GuildType extends { id: string }> =
  ContestActivityReplyInteraction & {
    guild: GuildType | null;
  };

function buildContestActivityContextResult<GuildType>(
  guild: GuildType,
  options: { days: number; limit: number; scope: ContestScopeFilter }
): { status: "ok"; guild: GuildType; days: number; limit: number; scope: ContestScopeFilter } {
  return {
    status: "ok",
    guild,
    days: options.days,
    limit: options.limit,
    scope: options.scope,
  };
}

export async function resolveContestActivityContextOrReply<GuildType extends { id: string }>(
  interaction: ContestActivityContextInteraction<GuildType>,
  config: ContestActivityOptionConfig,
  options: { guildMessage: string }
): Promise<
  | {
      status: "ok";
      guild: GuildType;
      days: number;
      limit: number;
      scope: ContestScopeFilter;
    }
  | { status: "replied" }
> {
  if (!interaction.guild) {
    await interaction.reply({ content: options.guildMessage });
    return { status: "replied" };
  }
  const result = await resolveContestActivityOptionsOrReply(interaction, config);
  if (result.status === "replied") {
    return { status: "replied" };
  }
  return buildContestActivityContextResult(interaction.guild, result);
}

type ContestActivityRosterStore = {
  getServerRoster: (guildId: string) => Promise<RosterEntry[]>;
};

type ContestActivityRosterInteraction = ContestActivityContextInteraction<Guild> & {
  commandName: string;
  user: { id: string };
  deferReply: () => Promise<unknown>;
  editReply: (message: string) => Promise<unknown>;
};

type ContestActivityRosterContextResult =
  | {
      status: "ok";
      guild: Guild;
      days: number;
      limit: number;
      scope: ContestScopeFilter;
      roster: RosterEntry[];
      excludedCount: number;
    }
  | { status: "replied" };

export async function resolveContestActivityRosterContextOrReply(
  interaction: ContestActivityRosterInteraction,
  config: ContestActivityOptionConfig,
  options: {
    guildMessage: string;
    store: ContestActivityRosterStore;
    correlationId?: string;
    rosterMessages?: RosterMessages;
  }
): Promise<ContestActivityRosterContextResult> {
  const contextResult = await resolveContestActivityContextOrReply(
    interaction,
    config,
    { guildMessage: options.guildMessage }
  );
  if (contextResult.status === "replied") {
    return { status: "replied" };
  }

  await interaction.deferReply();

  const rosterResult = await resolveGuildRosterFromStoreOrReply({
    guild: contextResult.guild,
    interaction,
    store: options.store,
    correlationId: options.correlationId,
    messages: options.rosterMessages,
  });
  if (rosterResult.status === "replied") {
    return { status: "replied" };
  }

  return {
    ...buildContestActivityContextResult(contextResult.guild, contextResult),
    roster: rosterResult.roster,
    excludedCount: rosterResult.excludedCount,
  };
}

export async function resolveContestActivityRosterContextWithDefaultsOrReply(
  interaction: ContestActivityRosterInteraction,
  messages: { daysErrorMessage: string; limitErrorMessage: string; guildMessage: string },
  options: {
    store: ContestActivityRosterStore;
    correlationId?: string;
    rosterMessages?: RosterMessages;
  }
): Promise<ContestActivityRosterContextResult> {
  const config = buildContestActivityOptionConfig({
    daysErrorMessage: messages.daysErrorMessage,
    limitErrorMessage: messages.limitErrorMessage,
  });
  return resolveContestActivityRosterContextOrReply(interaction, config, {
    guildMessage: messages.guildMessage,
    ...options,
  });
}
