import type { Guild } from "discord.js";

import { logWarn, type LogContext } from "./logger.js";

const MEMBER_CHUNK_SIZE = 100;

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

export async function filterEntriesByGuildMembers<T extends { userId: string }>(
  guild: Guild,
  entries: T[],
  context?: LogContext
): Promise<T[]> {
  if (entries.length === 0) {
    return [];
  }
  const uniqueIds = Array.from(new Set(entries.map((entry) => entry.userId)));
  const present = new Set<string>();
  const chunks = chunkIds(uniqueIds, MEMBER_CHUNK_SIZE);

  for (const chunk of chunks) {
    try {
      const members = await guild.members.fetch({ user: chunk });
      for (const member of members.values()) {
        present.add(member.user.id);
      }
    } catch (error) {
      logWarn("Guild member fetch failed; using cached members.", {
        ...context,
        guildId: guild.id,
        error: error instanceof Error ? error.message : String(error),
      });
      for (const id of chunk) {
        if (guild.members.cache.has(id)) {
          present.add(id);
        }
      }
    }
  }

  return entries.filter((entry) => present.has(entry.userId));
}
