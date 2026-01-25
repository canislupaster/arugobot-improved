import { createHash } from "node:crypto";

import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { isCacheFresh } from "../utils/cache.js";
import { logError, logWarn } from "../utils/logger.js";

import type { CodeforcesClient } from "./codeforces.js";
import type { Contest } from "./contests.js";

export type ContestStandingEntry = {
  handle: string;
  rank: number;
  points: number;
  penalty: number;
  participantType: string;
};

export type ContestStandingsResult = {
  entries: ContestStandingEntry[];
  source: "cache" | "api";
  isStale: boolean;
};

type ContestStandingsResponse = {
  rows: Array<{
    party: {
      members: Array<{ handle: string }>;
      participantType?: string;
    };
    rank: number;
    points: number;
    penalty: number;
  }>;
};

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const FINISHED_CACHE_TTL_MS = 60 * 60 * 1000;

function getCacheTtl(phase?: Contest["phase"]): number {
  if (!phase) {
    return DEFAULT_CACHE_TTL_MS;
  }
  if (phase === "FINISHED") {
    return FINISHED_CACHE_TTL_MS;
  }
  return DEFAULT_CACHE_TTL_MS;
}

export function hashHandles(handles: string[]): string {
  const normalized = handles.map((handle) => handle.toLowerCase()).sort();
  return createHash("sha1").update(normalized.join("|")).digest("hex");
}

function dedupeHandles(handles: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const handle of handles) {
    const trimmed = handle.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function mapEntries(rows: ContestStandingsResponse["rows"]): ContestStandingEntry[] {
  const entries: ContestStandingEntry[] = [];
  for (const row of rows) {
    const rank = Number.isFinite(row.rank) ? Math.max(0, Math.floor(row.rank)) : 0;
    const points = Number.isFinite(row.points) ? row.points : 0;
    const penalty = Number.isFinite(row.penalty) ? row.penalty : 0;
    const participantType = row.party.participantType ?? "CONTESTANT";
    for (const member of row.party.members) {
      entries.push({
        handle: member.handle,
        rank,
        points,
        penalty,
        participantType,
      });
    }
  }
  return entries;
}

export class ContestStandingsService {
  constructor(
    private db: Kysely<Database>,
    private client: Pick<CodeforcesClient, "request">
  ) {}

  async getStandings(
    contestId: number,
    handles: string[],
    phase?: Contest["phase"]
  ): Promise<ContestStandingsResult> {
    const uniqueHandles = dedupeHandles(handles);
    if (uniqueHandles.length === 0) {
      return { entries: [], source: "cache", isStale: false };
    }

    const handlesHash = hashHandles(uniqueHandles);
    const ttlMs = getCacheTtl(phase);
    const cached = await this.getCache(contestId, handlesHash);
    if (cached && isCacheFresh(cached.lastFetched, ttlMs)) {
      return { entries: cached.entries, source: "cache", isStale: false };
    }

    try {
      const response = await this.client.request<ContestStandingsResponse>("contest.standings", {
        contestId,
        handles: uniqueHandles.join(";"),
        showUnofficial: true,
      });
      const entries = mapEntries(response.rows);
      await this.setCache(contestId, handlesHash, uniqueHandles, entries);
      return { entries, source: "api", isStale: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("Contest standings request failed.", { contestId, error: message });
      if (cached) {
        return { entries: cached.entries, source: "cache", isStale: true };
      }
      throw error;
    }
  }

  private async getCache(
    contestId: number,
    handlesHash: string
  ): Promise<{ entries: ContestStandingEntry[]; lastFetched: string } | null> {
    const row = await this.db
      .selectFrom("contest_standings_cache")
      .select(["payload", "last_fetched"])
      .where("contest_id", "=", contestId)
      .where("handles_hash", "=", handlesHash)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    try {
      const parsed = JSON.parse(row.payload) as ContestStandingEntry[];
      if (!Array.isArray(parsed)) {
        return null;
      }
      return { entries: parsed, lastFetched: row.last_fetched };
    } catch (error) {
      logWarn("Failed to parse cached contest standings.", {
        contestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async setCache(
    contestId: number,
    handlesHash: string,
    handles: string[],
    entries: ContestStandingEntry[]
  ): Promise<void> {
    const payload = JSON.stringify(entries);
    const timestamp = new Date().toISOString();
    await this.db
      .insertInto("contest_standings_cache")
      .values({
        contest_id: contestId,
        handles_hash: handlesHash,
        handles: JSON.stringify(handles),
        payload,
        last_fetched: timestamp,
      })
      .onConflict((oc) =>
        oc.columns(["contest_id", "handles_hash"]).doUpdateSet({
          handles: JSON.stringify(handles),
          payload,
          last_fetched: timestamp,
        })
      )
      .execute();
  }
}
