import type { Guild } from "discord.js";

import type { LogContext } from "./logger.js";
import { filterEntriesByGuildMembers } from "./guildMembers.js";

export type RosterEntry = {
  userId: string;
  handle: string;
};

export type RosterResolution =
  | { status: "ok"; roster: RosterEntry[] }
  | { status: "empty"; message: string; reason: "no_handles" | "no_members" };

const NO_LINKED_HANDLES_MESSAGE =
  "No linked handles yet. Use /register to link a Codeforces handle.";
const NO_MEMBER_HANDLES_MESSAGE = "No linked handles found for current server members.";

export async function resolveGuildRoster(
  guild: Guild,
  roster: RosterEntry[],
  context: LogContext
): Promise<RosterResolution> {
  if (roster.length === 0) {
    return { status: "empty", message: NO_LINKED_HANDLES_MESSAGE, reason: "no_handles" };
  }
  const filtered = await filterEntriesByGuildMembers(guild, roster, context);
  if (filtered.length === 0) {
    return { status: "empty", message: NO_MEMBER_HANDLES_MESSAGE, reason: "no_members" };
  }
  return { status: "ok", roster: filtered };
}
