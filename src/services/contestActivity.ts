import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError, logWarn } from "../utils/logger.js";

import type { ContestScope } from "./contests.js";
import type { RatingChange, RatingChangesService } from "./ratingChanges.js";
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
    scope: ContestScope;
  }>;
  byScope: ContestScopeBreakdown;
};

export type ContestParticipantSummary = {
  userId: string;
  handle: string;
  contestCount: number;
  officialCount: number;
  gymCount: number;
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
  byScope: ContestScopeBreakdown;
};

export type ContestScopeSummary = {
  contestCount: number;
  participantCount: number;
  lastContestAt: number | null;
};

export type ContestScopeBreakdown = {
  official: ContestScopeSummary;
  gym: ContestScopeSummary;
};

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_RECENT_LIMIT = 4;
const MAX_REFRESH_HANDLES = 500;

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

function createEmptyScopeSummary(): ContestScopeSummary {
  return { contestCount: 0, participantCount: 0, lastContestAt: null };
}

function createScopeBreakdown(): ContestScopeBreakdown {
  return {
    official: createEmptyScopeSummary(),
    gym: createEmptyScopeSummary(),
  };
}

type CachedContest = { id: number; isGym?: boolean };

function sortParticipants(a: ContestParticipantSummary, b: ContestParticipantSummary): number {
  if (b.contestCount !== a.contestCount) {
    return b.contestCount - a.contestCount;
  }
  return a.handle.localeCompare(b.handle);
}

export class ContestActivityService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly store: StoreService,
    private readonly ratingChanges: RatingChangesService
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
        byScope: createScopeBreakdown(),
        participants: [],
      };
    }

    const rosterMap = new Map(
      roster.map((row) => [normalizeHandle(row.handle), { userId: row.userId, handle: row.handle }])
    );

    try {
      await this.refreshMissingRatingChanges(handles, rosterMap);
      const rows = await this.db
        .selectFrom("cf_rating_changes")
        .select(["handle", "payload"])
        .where("handle", "in", handles)
        .execute();

      const cutoffSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
      const contestScopes = await this.loadContestScopeMap();
      const contestMap = new Map<
        number,
        {
          contestId: number;
          contestName: string;
          ratingUpdateTimeSeconds: number;
          scope: ContestScope;
        }
      >();
      const scopeContestMap = {
        official: new Map<number, number>(),
        gym: new Map<number, number>(),
      };
      const scopeParticipants = {
        official: new Set<string>(),
        gym: new Set<string>(),
      };
      const scopeLastContest = {
        official: null as number | null,
        gym: null as number | null,
      };
      const participants = new Map<string, ContestParticipantSummary>();

      for (const row of rows) {
        const rosterEntry = rosterMap.get(row.handle);
        if (!rosterEntry) {
          continue;
        }
        const changes = parseRatingChangesPayload(row.payload);
        let lastContestAt: number | null = null;
        const contestIds = new Set<number>();
        const contestIdsByScope = {
          official: new Set<number>(),
          gym: new Set<number>(),
        };

        for (const change of changes) {
          if (change.ratingUpdateTimeSeconds < cutoffSeconds) {
            continue;
          }
          contestIds.add(change.contestId);
          if (!lastContestAt || change.ratingUpdateTimeSeconds > lastContestAt) {
            lastContestAt = change.ratingUpdateTimeSeconds;
          }
          const scope = contestScopes.get(change.contestId) ?? "official";
          contestIdsByScope[scope].add(change.contestId);
          scopeParticipants[scope].add(row.handle);
          if (
            scopeLastContest[scope] === null ||
            change.ratingUpdateTimeSeconds > scopeLastContest[scope]!
          ) {
            scopeLastContest[scope] = change.ratingUpdateTimeSeconds;
          }
          const scopedMap = scopeContestMap[scope];
          const scopedExisting = scopedMap.get(change.contestId);
          if (!scopedExisting || change.ratingUpdateTimeSeconds > scopedExisting) {
            scopedMap.set(change.contestId, change.ratingUpdateTimeSeconds);
          }

          const existing = contestMap.get(change.contestId);
          if (!existing || change.ratingUpdateTimeSeconds > existing.ratingUpdateTimeSeconds) {
            contestMap.set(change.contestId, {
              contestId: change.contestId,
              contestName: change.contestName,
              ratingUpdateTimeSeconds: change.ratingUpdateTimeSeconds,
              scope,
            });
          }
        }

        if (contestIds.size > 0) {
          participants.set(row.handle, {
            userId: rosterEntry.userId,
            handle: rosterEntry.handle,
            contestCount: contestIds.size,
            officialCount: contestIdsByScope.official.size,
            gymCount: contestIdsByScope.gym.size,
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
      const byScope: ContestScopeBreakdown = {
        official: {
          contestCount: scopeContestMap.official.size,
          participantCount: scopeParticipants.official.size,
          lastContestAt: scopeLastContest.official,
        },
        gym: {
          contestCount: scopeContestMap.gym.size,
          participantCount: scopeParticipants.gym.size,
          lastContestAt: scopeLastContest.gym,
        },
      };

      return {
        lookbackDays,
        contestCount: contestMap.size,
        participantCount,
        recentContests,
        byScope,
        participants: participantList,
      };
    } catch (error) {
      logError(`Database error (contest activity): ${String(error)}`);
      return {
        lookbackDays,
        contestCount: 0,
        participantCount: 0,
        recentContests: [],
        byScope: createScopeBreakdown(),
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
        byScope: createScopeBreakdown(),
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
          byScope: createScopeBreakdown(),
        };
      }

      const handleMap = new Map(handles.map((handle) => [normalizeHandle(handle), { handle }]));
      await this.refreshMissingRatingChanges(handles, handleMap);
      const rows = await this.db
        .selectFrom("cf_rating_changes")
        .select(["handle", "payload"])
        .where("handle", "in", handles)
        .execute();

      const cutoffSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
      const contestScopes = await this.loadContestScopeMap();
      const contestMap = new Map<number, number>();
      const scopeContestMap = {
        official: new Map<number, number>(),
        gym: new Map<number, number>(),
      };
      const scopeParticipants = {
        official: new Set<string>(),
        gym: new Set<string>(),
      };
      const scopeLastContest = {
        official: null as number | null,
        gym: null as number | null,
      };
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
          const scope = contestScopes.get(change.contestId) ?? "official";
          scopeParticipants[scope].add(row.handle);
          if (
            scopeLastContest[scope] === null ||
            change.ratingUpdateTimeSeconds > scopeLastContest[scope]!
          ) {
            scopeLastContest[scope] = change.ratingUpdateTimeSeconds;
          }
          const scopedMap = scopeContestMap[scope];
          const scopedExisting = scopedMap.get(change.contestId);
          if (!scopedExisting || change.ratingUpdateTimeSeconds > scopedExisting) {
            scopedMap.set(change.contestId, change.ratingUpdateTimeSeconds);
          }
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
        byScope: {
          official: {
            contestCount: scopeContestMap.official.size,
            participantCount: scopeParticipants.official.size,
            lastContestAt: scopeLastContest.official,
          },
          gym: {
            contestCount: scopeContestMap.gym.size,
            participantCount: scopeParticipants.gym.size,
            lastContestAt: scopeLastContest.gym,
          },
        },
      };
    } catch (error) {
      logError(`Database error (global contest activity): ${String(error)}`);
      return {
        lookbackDays,
        contestCount: 0,
        participantCount: 0,
        lastContestAt: null,
        byScope: createScopeBreakdown(),
      };
    }
  }

  private async loadContestScopeMap(): Promise<Map<number, ContestScope>> {
    const map = new Map<number, ContestScope>();
    try {
      const rows = await this.db
        .selectFrom("cf_cache")
        .select(["key", "payload"])
        .where("key", "in", ["contest_list", "contest_list_gym"])
        .execute();
      for (const row of rows) {
        const isGymDefault = row.key === "contest_list_gym";
        try {
          const parsed = JSON.parse(row.payload) as CachedContest[];
          if (!Array.isArray(parsed)) {
            continue;
          }
          for (const contest of parsed) {
            if (!contest || !Number.isFinite(contest.id)) {
              continue;
            }
            const scope: ContestScope = contest.isGym || isGymDefault ? "gym" : "official";
            map.set(contest.id, scope);
          }
        } catch (error) {
          logWarn("Failed to parse contest list cache for activity scope.", {
            error: error instanceof Error ? error.message : String(error),
            key: row.key,
          });
        }
      }
    } catch (error) {
      logWarn("Failed to load contest list cache for activity scope.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return map;
  }

  private async refreshMissingRatingChanges(
    handles: string[],
    handleMap: Map<string, { handle: string }>
  ): Promise<void> {
    const normalized = handles.map((handle) => normalizeHandle(handle)).filter(Boolean);
    if (normalized.length === 0) {
      return;
    }
    const uniqueHandles = Array.from(new Set(normalized));
    const cached = await this.db
      .selectFrom("cf_rating_changes")
      .select("handle")
      .where("handle", "in", uniqueHandles)
      .execute();
    const cachedSet = new Set(cached.map((row) => normalizeHandle(row.handle)));
    const missing = uniqueHandles.filter((handle) => !cachedSet.has(handle));
    if (missing.length === 0) {
      return;
    }

    const toRefresh = missing.slice(0, MAX_REFRESH_HANDLES);
    for (const handle of toRefresh) {
      const entry = handleMap.get(handle);
      const originalHandle = entry?.handle ?? handle;
      try {
        await this.ratingChanges.getRatingChanges(originalHandle);
      } catch (error) {
        logWarn("Contest activity rating refresh failed.", {
          handle: originalHandle,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (missing.length > toRefresh.length) {
      logWarn("Contest activity rating refresh truncated.", {
        attempted: toRefresh.length,
        totalMissing: missing.length,
      });
    }
  }
}
