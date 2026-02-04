import { createHash } from "node:crypto";

import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { isCacheFresh } from "../utils/cache.js";
import { dedupeHandles, normalizeHandleKey } from "../utils/handles.js";
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

export function hashHandles(handles: string[], showUnofficial = false): string {
  const normalized = handles
    .map((handle) => normalizeHandleKey(handle))
    .filter(Boolean)
    .sort();
  const payload = `${normalized.join("|")}|unofficial:${showUnofficial ? "1" : "0"}`;
  return createHash("sha1").update(payload).digest("hex");
}

function mapEntries(rows: ContestStandingsResponse["rows"]): ContestStandingEntry[] {
  const entries: ContestStandingEntry[] = [];
  for (const row of rows) {
    const rank = Math.max(0, Math.floor(row.rank));
    const points = row.points;
    const penalty = row.penalty;
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

function parseCachedEntries(
  payload: string
): { entries: ContestStandingEntry[] | null; error?: string } {
  try {
    const parsed = JSON.parse(payload) as ContestStandingEntry[];
    if (!Array.isArray(parsed)) {
      return { entries: null, error: "Cached standings payload was not an array." };
    }
    return { entries: parsed };
  } catch (error) {
    return {
      entries: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export class ContestStandingsService {
  constructor(
    private db: Kysely<Database>,
    private client: Pick<CodeforcesClient, "request">
  ) {}

  async getStandings(
    contestId: number,
    handles: string[],
    phase?: Contest["phase"],
    showUnofficial = false
  ): Promise<ContestStandingsResult> {
    const uniqueHandles = dedupeHandles(handles);
    if (uniqueHandles.length === 0) {
      return { entries: [], source: "cache", isStale: false };
    }

    const handlesHash = hashHandles(uniqueHandles, showUnofficial);
    const ttlMs = getCacheTtl(phase);
    const cached = await this.getCache(contestId, handlesHash);
    if (cached && isCacheFresh(cached.lastFetched, ttlMs)) {
      return { entries: cached.entries, source: "cache", isStale: false };
    }

    try {
      const response = await this.client.request<ContestStandingsResponse>("contest.standings", {
        contestId,
        handles: uniqueHandles.join(";"),
        showUnofficial,
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
    const { entries, error } = parseCachedEntries(row.payload);
    if (!entries) {
      logWarn("Failed to parse cached contest standings.", {
        contestId,
        error,
      });
      return null;
    }
    return { entries, lastFetched: row.last_fetched };
  }

  private async setCache(
    contestId: number,
    handlesHash: string,
    handles: string[],
    entries: ContestStandingEntry[]
  ): Promise<void> {
    const handlesPayload = JSON.stringify(handles);
    const payload = JSON.stringify(entries);
    const timestamp = new Date().toISOString();
    await this.db
      .insertInto("contest_standings_cache")
      .values({
        contest_id: contestId,
        handles_hash: handlesHash,
        handles: handlesPayload,
        payload,
        last_fetched: timestamp,
      })
      .onConflict((oc) =>
        oc.columns(["contest_id", "handles_hash"]).doUpdateSet({
          handles: handlesPayload,
          payload,
          last_fetched: timestamp,
        })
      )
      .execute();
  }
}
