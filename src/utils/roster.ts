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
