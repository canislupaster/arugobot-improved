import type { Guild } from "discord.js";

import { logWarn, type LogContext } from "./logger.js";

const MEMBER_CHUNK_SIZE = 100;

type GuildMemberLike = {
  user: { id: string };
  toString?: () => string;
};

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

async function fetchMembersWithFallback(
  guild: Guild,
  userIds: string[],
  context?: LogContext
): Promise<Map<string, GuildMemberLike>> {
  const membersById = new Map<string, GuildMemberLike>();
  if (userIds.length === 0) {
    return membersById;
  }
  const unique = uniqueIds(userIds);
  const chunks = chunkIds(unique, MEMBER_CHUNK_SIZE);

  for (const chunk of chunks) {
    try {
      const members = await guild.members.fetch({ user: chunk });
      for (const member of members.values()) {
        membersById.set(member.user.id, member);
      }
    } catch (error) {
      logWarn("Guild member fetch failed; using cached members.", {
        ...context,
        guildId: guild.id,
        error: error instanceof Error ? error.message : String(error),
      });
      for (const id of chunk) {
        const cached = guild.members.cache.get(id);
        if (cached) {
          membersById.set(id, cached);
        }
      }
    }
  }

  return membersById;
}

export async function filterEntriesByGuildMembers<T extends { userId: string }>(
  guild: Guild,
  entries: T[],
  context?: LogContext
): Promise<T[]> {
  if (entries.length === 0) {
    return [];
  }
  const membersById = await fetchMembersWithFallback(
    guild,
    entries.map((entry) => entry.userId),
    context
  );
  return entries.filter((entry) => membersById.has(entry.userId));
}

function formatMemberMention(member: GuildMemberLike): string {
  if (typeof member.toString === "function") {
    return member.toString();
  }
  return `<@${member.user.id}>`;
}

export async function resolveMemberMentions(
  guild: Guild,
  userIds: string[],
  context?: LogContext
): Promise<Map<string, string>> {
  const mentions = new Map<string, string>();
  if (userIds.length === 0) {
    return mentions;
  }
  const unique = uniqueIds(userIds);
  const membersById = await fetchMembersWithFallback(guild, unique, context);
  for (const [id, member] of membersById.entries()) {
    mentions.set(id, formatMemberMention(member));
  }
  for (const id of unique) {
    mentions.set(id, mentions.get(id) ?? `<@${id}>`);
  }

  return mentions;
}
