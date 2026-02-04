import type { Guild } from "discord.js";

import { filterEntriesByGuildMembers } from "./guildMembers.js";
import type { LogContext } from "./logger.js";

export type RosterEntryBase = {
  userId: string;
};

export type RosterEntry = RosterEntryBase & {
  handle: string;
};

export type RatedRosterEntry = RosterEntry & {
  rating: number;
};

export type RosterResolution<T extends RosterEntryBase> =
  | { status: "ok"; roster: T[]; excludedCount: number }
  | {
      status: "empty";
      message: string;
      reason: "no_handles" | "no_members";
      excludedCount: number;
    };

export type RosterMessages = {
  noHandles?: string;
  noMembers?: string;
};

type RosterReplyInteraction = {
  editReply: (message: string) => Promise<unknown>;
};

const NO_LINKED_HANDLES_MESSAGE =
  "No linked handles yet. Use /register to link a Codeforces handle.";
const NO_MEMBER_HANDLES_MESSAGE = "No linked handles found for current server members.";

export function formatRatedRosterLines(
  roster: RatedRosterEntry[],
  start: number,
  count: number
): string {
  return roster
    .slice(start, start + count)
    .map(
      (entry, index) =>
        `${start + index + 1}. <@${entry.userId}> - ${entry.handle} (${entry.rating})`
    )
    .join("\n");
}

export function buildRosterExcludedField(
  excludedCount: number
): { name: string; value: string; inline: true } | null {
  if (excludedCount <= 0) {
    return null;
  }
  const label = excludedCount === 1 ? "Excluded handle" : "Excluded handles";
  return { name: label, value: `${excludedCount} not in server`, inline: true };
}

type EmbedFieldTarget = {
  addFields: (...fields: Array<{ name: string; value: string; inline?: boolean }>) => unknown;
};

export function appendRosterExcludedField(
  target: EmbedFieldTarget,
  excludedCount: number
): void {
  const field = buildRosterExcludedField(excludedCount);
  if (field) {
    target.addFields(field);
  }
}

export async function resolveGuildRoster<T extends RosterEntryBase>(
  guild: Guild,
  roster: T[],
  context: LogContext,
  messages: RosterMessages = {}
): Promise<RosterResolution<T>> {
  const noHandlesMessage = messages.noHandles ?? NO_LINKED_HANDLES_MESSAGE;
  const noMembersMessage = messages.noMembers ?? NO_MEMBER_HANDLES_MESSAGE;

  if (roster.length === 0) {
    return {
      status: "empty",
      message: noHandlesMessage,
      reason: "no_handles",
      excludedCount: 0,
    };
  }
  const filtered = await filterEntriesByGuildMembers(guild, roster, context);
  const excludedCount = Math.max(0, roster.length - filtered.length);
  if (filtered.length === 0) {
    return {
      status: "empty",
      message: noMembersMessage,
      reason: "no_members",
      excludedCount,
    };
  }
  return { status: "ok", roster: filtered, excludedCount };
}

export async function resolveGuildRosterOrReply<T extends RosterEntryBase>(
  guild: Guild,
  roster: T[],
  context: LogContext,
  interaction: RosterReplyInteraction,
  messages: RosterMessages = {}
): Promise<{ status: "ok"; roster: T[]; excludedCount: number } | { status: "replied" }> {
  const result = await resolveGuildRoster(guild, roster, context, messages);
  if (result.status === "empty") {
    await interaction.editReply(result.message);
    return { status: "replied" };
  }
  return result;
}

type RosterStore = {
  getServerRoster: (guildId: string) => Promise<RosterEntry[]>;
};

type RosterFetchInteraction = {
  commandName: string;
  user: { id: string };
  editReply: (message: string) => Promise<unknown>;
};

export async function resolveGuildRosterFromStoreOrReply(params: {
  guild: Guild;
  interaction: RosterFetchInteraction;
  store: RosterStore;
  correlationId?: string;
  messages?: RosterMessages;
}): Promise<{ status: "ok"; roster: RosterEntry[]; excludedCount: number } | { status: "replied" }> {
  const roster = await params.store.getServerRoster(params.guild.id);
  return resolveGuildRosterOrReply(
    params.guild,
    roster,
    {
      correlationId: params.correlationId,
      command: params.interaction.commandName,
      guildId: params.guild.id,
      userId: params.interaction.user.id,
    },
    params.interaction,
    params.messages
  );
}
