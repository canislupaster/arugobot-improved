import type { Guild } from "discord.js";

import { filterEntriesByGuildMembers } from "./guildMembers.js";
import type { LogContext } from "./logger.js";

export type RosterEntryBase = {
  userId: string;
};

export type RosterEntry = RosterEntryBase & {
  handle: string;
};

export type RosterResolution<T extends RosterEntryBase> =
  | { status: "ok"; roster: T[] }
  | { status: "empty"; message: string; reason: "no_handles" | "no_members" };

export type RosterMessages = {
  noHandles?: string;
  noMembers?: string;
};

const NO_LINKED_HANDLES_MESSAGE =
  "No linked handles yet. Use /register to link a Codeforces handle.";
const NO_MEMBER_HANDLES_MESSAGE = "No linked handles found for current server members.";

export async function resolveGuildRoster<T extends RosterEntryBase>(
  guild: Guild,
  roster: T[],
  context: LogContext,
  messages: RosterMessages = {}
): Promise<RosterResolution<T>> {
  const noHandlesMessage = messages.noHandles ?? NO_LINKED_HANDLES_MESSAGE;
  const noMembersMessage = messages.noMembers ?? NO_MEMBER_HANDLES_MESSAGE;

  if (roster.length === 0) {
    return { status: "empty", message: noHandlesMessage, reason: "no_handles" };
  }
  const filtered = await filterEntriesByGuildMembers(guild, roster, context);
  if (filtered.length === 0) {
    return { status: "empty", message: noMembersMessage, reason: "no_members" };
  }
  return { status: "ok", roster: filtered };
}
