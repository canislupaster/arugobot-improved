import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError } from "../utils/logger.js";

import type { RatingChange } from "./ratingChanges.js";
import type { StoreService } from "./store.js";

type RosterEntry = { userId: string; handle: string };

export type ContestActivitySummary = {
  lookbackDays: number;
  contestCount: number;
  participantCount: number;
  recentContests: Array<{
    contestId: number;
    contestName: string;
    ratingUpdateTimeSeconds: number;
  }>;
};

export type ContestParticipantSummary = {
  userId: string;
  handle: string;
  contestCount: number;
  lastContestAt: number | null;
};

export type GuildContestActivity = ContestActivitySummary & {
  participants: ContestParticipantSummary[];
};

export type GlobalContestActivity = {
  lookbackDays: number;
  contestCount: number;
  participantCount: number;
  lastContestAt: number | null;
};

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_RECENT_LIMIT = 4;

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function parseRatingChangesPayload(payload: string): RatingChange[] {
  try {
    const parsed = JSON.parse(payload) as RatingChange[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry) =>
        Number.isFinite(entry.contestId) &&
        Number.isFinite(entry.rank) &&
        Number.isFinite(entry.oldRating) &&
        Number.isFinite(entry.newRating) &&
        Number.isFinite(entry.ratingUpdateTimeSeconds)
    );
  } catch {
    return [];
  }
}

function sortParticipants(a: ContestParticipantSummary, b: ContestParticipantSummary): number {
  if (b.contestCount !== a.contestCount) {
    return b.contestCount - a.contestCount;
  }
  return a.handle.localeCompare(b.handle);
}

export class ContestActivityService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly store: StoreService
  ) {}

  async getGuildContestActivity(
    guildId: string,
    options?: {
      lookbackDays?: number;
      recentLimit?: number;
      participantLimit?: number;
    }
  ): Promise<GuildContestActivity> {
    const roster = await this.store.getServerRoster(guildId);
    return this.getContestActivityForRoster(roster, options);
  }

  async getContestActivityForRoster(
    roster: RosterEntry[],
    options?: {
      lookbackDays?: number;
      recentLimit?: number;
      participantLimit?: number;
    }
  ): Promise<GuildContestActivity> {
    const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const recentLimit = Math.max(1, options?.recentLimit ?? DEFAULT_RECENT_LIMIT);
    const participantLimit = options?.participantLimit ?? null;
    const handles = roster.map((row) => normalizeHandle(row.handle)).filter(Boolean);
    if (handles.length === 0) {
      return {
        lookbackDays,
        contestCount: 0,
        participantCount: 0,
        recentContests: [],
        participants: [],
      };
    }

    const rosterMap = new Map(
      roster.map((row) => [normalizeHandle(row.handle), { userId: row.userId, handle: row.handle }])
    );

    try {
      const rows = await this.db
        .selectFrom("cf_rating_changes")
        .select(["handle", "payload"])
        .where("handle", "in", handles)
        .execute();

      const cutoffSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
      const contestMap = new Map<
        number,
        { contestId: number; contestName: string; ratingUpdateTimeSeconds: number }
      >();
      const participants = new Map<string, ContestParticipantSummary>();

      for (const row of rows) {
        const rosterEntry = rosterMap.get(row.handle);
        if (!rosterEntry) {
          continue;
        }
        const changes = parseRatingChangesPayload(row.payload);
        let lastContestAt: number | null = null;
        const contestIds = new Set<number>();

        for (const change of changes) {
          if (change.ratingUpdateTimeSeconds < cutoffSeconds) {
            continue;
          }
          contestIds.add(change.contestId);
          if (!lastContestAt || change.ratingUpdateTimeSeconds > lastContestAt) {
            lastContestAt = change.ratingUpdateTimeSeconds;
          }
          const existing = contestMap.get(change.contestId);
          if (!existing || change.ratingUpdateTimeSeconds > existing.ratingUpdateTimeSeconds) {
            contestMap.set(change.contestId, {
              contestId: change.contestId,
              contestName: change.contestName,
              ratingUpdateTimeSeconds: change.ratingUpdateTimeSeconds,
            });
          }
        }

        if (contestIds.size > 0) {
          participants.set(row.handle, {
            userId: rosterEntry.userId,
            handle: rosterEntry.handle,
            contestCount: contestIds.size,
            lastContestAt,
          });
        }
      }

      const participantCount = participants.size;
      let participantList = Array.from(participants.values()).sort(sortParticipants);
      if (participantLimit && participantLimit > 0) {
        participantList = participantList.slice(0, participantLimit);
      }
      const recentContests = Array.from(contestMap.values())
        .sort((a, b) => b.ratingUpdateTimeSeconds - a.ratingUpdateTimeSeconds)
        .slice(0, recentLimit);

      return {
        lookbackDays,
        contestCount: contestMap.size,
        participantCount,
        recentContests,
        participants: participantList,
      };
    } catch (error) {
      logError(`Database error (contest activity): ${String(error)}`);
      return {
        lookbackDays,
        contestCount: 0,
        participantCount: 0,
        recentContests: [],
        participants: [],
      };
    }
  }

  async getGlobalContestActivity(
    guildIds: string[],
    lookbackDays = DEFAULT_LOOKBACK_DAYS
  ): Promise<GlobalContestActivity> {
    if (guildIds.length === 0) {
      return {
        lookbackDays,
        contestCount: 0,
        participantCount: 0,
        lastContestAt: null,
      };
    }

    try {
      const handleRows = await this.db
        .selectFrom("users")
        .select("handle")
        .where("server_id", "in", guildIds)
        .execute();
      const handles = Array.from(
        new Set(handleRows.map((row) => normalizeHandle(row.handle)).filter(Boolean))
      );
      if (handles.length === 0) {
        return {
          lookbackDays,
          contestCount: 0,
          participantCount: 0,
          lastContestAt: null,
        };
      }

      const rows = await this.db
        .selectFrom("cf_rating_changes")
        .select(["handle", "payload"])
        .where("handle", "in", handles)
        .execute();

      const cutoffSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
      const contestMap = new Map<number, number>();
      const participantSet = new Set<string>();
      let lastContestAt: number | null = null;

      for (const row of rows) {
        const changes = parseRatingChangesPayload(row.payload);
        let hasEntry = false;
        for (const change of changes) {
          if (change.ratingUpdateTimeSeconds < cutoffSeconds) {
            continue;
          }
          hasEntry = true;
          contestMap.set(
            change.contestId,
            Math.max(contestMap.get(change.contestId) ?? 0, change.ratingUpdateTimeSeconds)
          );
          if (!lastContestAt || change.ratingUpdateTimeSeconds > lastContestAt) {
            lastContestAt = change.ratingUpdateTimeSeconds;
          }
        }
        if (hasEntry) {
          participantSet.add(row.handle);
        }
      }

      return {
        lookbackDays,
        contestCount: contestMap.size,
        participantCount: participantSet.size,
        lastContestAt,
      };
    } catch (error) {
      logError(`Database error (global contest activity): ${String(error)}`);
      return {
        lookbackDays,
        contestCount: 0,
        participantCount: 0,
        lastContestAt: null,
      };
    }
  }
}
