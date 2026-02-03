import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { normalizeHandleKey } from "../utils/handles.js";
import { logError, logWarn } from "../utils/logger.js";
import { parseRatingChangesPayload } from "../utils/ratingChanges.js";

import type { ContestScope, ContestScopeFilter } from "./contests.js";
import type { RatingChangesService } from "./ratingChanges.js";
import type { StoreService } from "./store.js";

type RosterEntry = { userId: string; handle: string };

export type ContestActivitySummary = {
  lookbackDays: number;
  contestCount: number;
  participantCount: number;
  topContests: ContestParticipationSummary[];
  recentContests: Array<{
    contestId: number;
    contestName: string;
    ratingUpdateTimeSeconds: number;
    scope: ContestScope;
  }>;
  byScope: ContestScopeBreakdown;
};

export type ContestParticipationSummary = {
  contestId: number;
  contestName: string;
  participantCount: number;
  ratingUpdateTimeSeconds: number;
  scope: ContestScope;
};

export type ContestParticipantSummary = {
  userId: string;
  handle: string;
  contestCount: number;
  officialCount: number;
  gymCount: number;
  lastContestAt: number | null;
};

export type RatingChangeParticipantSummary = {
  userId: string;
  handle: string;
  contestCount: number;
  delta: number;
  lastContestAt: number | null;
};

export type GuildContestActivity = ContestActivitySummary & {
  participants: ContestParticipantSummary[];
};

export type GuildRatingChangeSummary = {
  lookbackDays: number;
  contestCount: number;
  participantCount: number;
  totalDelta: number;
  lastContestAt: number | null;
  topGainers: RatingChangeParticipantSummary[];
  topLosers: RatingChangeParticipantSummary[];
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
const DEFAULT_TOP_CONTEST_LIMIT = 3;
const DEFAULT_DELTA_LIMIT = 3;
const MAX_REFRESH_HANDLES = 500;

function createEmptyScopeSummary(): ContestScopeSummary {
  return { contestCount: 0, participantCount: 0, lastContestAt: null };
}

function createScopeBreakdown(): ContestScopeBreakdown {
  return {
    official: createEmptyScopeSummary(),
    gym: createEmptyScopeSummary(),
  };
}

function createScopeStats(): ScopeStats {
  return {
    scopeContestMap: {
      official: new Map<number, number>(),
      gym: new Map<number, number>(),
    },
    scopeParticipants: {
      official: new Set<string>(),
      gym: new Set<string>(),
    },
    scopeLastContest: {
      official: null,
      gym: null,
    },
  };
}

function buildScopeBreakdown(stats: ScopeStats): ContestScopeBreakdown {
  return {
    official: {
      contestCount: stats.scopeContestMap.official.size,
      participantCount: stats.scopeParticipants.official.size,
      lastContestAt: stats.scopeLastContest.official,
    },
    gym: {
      contestCount: stats.scopeContestMap.gym.size,
      participantCount: stats.scopeParticipants.gym.size,
      lastContestAt: stats.scopeLastContest.gym,
    },
  };
}

type CachedContest = { id: number; isGym?: boolean };

type ScopeContestMap = {
  official: Map<number, number>;
  gym: Map<number, number>;
};

type ScopeParticipants = {
  official: Set<string>;
  gym: Set<string>;
};

type ScopeLastContest = {
  official: number | null;
  gym: number | null;
};

type ScopeStats = {
  scopeContestMap: ScopeContestMap;
  scopeParticipants: ScopeParticipants;
  scopeLastContest: ScopeLastContest;
};

function sortParticipants(a: ContestParticipantSummary, b: ContestParticipantSummary): number {
  if (b.contestCount !== a.contestCount) {
    return b.contestCount - a.contestCount;
  }
  return a.handle.localeCompare(b.handle);
}

function sortDeltaDescending(a: RatingChangeParticipantSummary, b: RatingChangeParticipantSummary) {
  if (b.delta !== a.delta) {
    return b.delta - a.delta;
  }
  return a.handle.localeCompare(b.handle);
}

function sortDeltaAscending(a: RatingChangeParticipantSummary, b: RatingChangeParticipantSummary) {
  if (a.delta !== b.delta) {
    return a.delta - b.delta;
  }
  return a.handle.localeCompare(b.handle);
}

function resolveContestScope(
  scopeMap: Map<number, ContestScope> | null,
  contestId: number
): ContestScope {
  return scopeMap?.get(contestId) ?? "official";
}

function matchesScope(scopeFilter: ContestScopeFilter, scope: ContestScope): boolean {
  return scopeFilter === "all" || scope === scopeFilter;
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

  async getGuildRatingChangeSummary(
    guildId: string,
    options?: {
      lookbackDays?: number;
      limit?: number;
      scope?: ContestScopeFilter;
    }
  ): Promise<GuildRatingChangeSummary> {
    const roster = await this.store.getServerRoster(guildId);
    return this.getRatingChangeSummaryForRoster(roster, options);
  }

  async getContestActivityForRoster(
    roster: RosterEntry[],
    options?: {
      lookbackDays?: number;
      recentLimit?: number;
      participantLimit?: number;
      topContestLimit?: number;
    }
  ): Promise<GuildContestActivity> {
    const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const recentLimit = Math.max(1, options?.recentLimit ?? DEFAULT_RECENT_LIMIT);
    const topContestLimit = Math.max(1, options?.topContestLimit ?? DEFAULT_TOP_CONTEST_LIMIT);
    const participantLimit = options?.participantLimit ?? null;
    const { handles, rosterMap } = this.buildRosterLookup(roster);
    if (handles.length === 0) {
      return {
        lookbackDays,
        contestCount: 0,
        participantCount: 0,
        topContests: [],
        recentContests: [],
        byScope: createScopeBreakdown(),
        participants: [],
      };
    }

    try {
      const rows = await this.loadRatingChangeRows(handles, rosterMap);

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
      const scopeStats = createScopeStats();
      const participants = new Map<string, ContestParticipantSummary>();
      const contestParticipantCounts = new Map<number, number>();

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
          this.updateScopeStats(
            scopeStats,
            scope,
            change.contestId,
            change.ratingUpdateTimeSeconds,
            row.handle
          );

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
          for (const contestId of contestIds) {
            contestParticipantCounts.set(
              contestId,
              (contestParticipantCounts.get(contestId) ?? 0) + 1
            );
          }
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
      const topContests = Array.from(contestParticipantCounts.entries())
        .map(([contestId, participantCount]) => {
          const contest = contestMap.get(contestId);
          if (!contest) {
            return null;
          }
          return {
            contestId,
            contestName: contest.contestName,
            participantCount,
            ratingUpdateTimeSeconds: contest.ratingUpdateTimeSeconds,
            scope: contest.scope,
          };
        })
        .filter((contest): contest is ContestParticipationSummary => Boolean(contest))
        .sort((a, b) => {
          if (b.participantCount !== a.participantCount) {
            return b.participantCount - a.participantCount;
          }
          if (b.ratingUpdateTimeSeconds !== a.ratingUpdateTimeSeconds) {
            return b.ratingUpdateTimeSeconds - a.ratingUpdateTimeSeconds;
          }
          return a.contestName.localeCompare(b.contestName);
        })
        .slice(0, topContestLimit);
      const recentContests = Array.from(contestMap.values())
        .sort((a, b) => b.ratingUpdateTimeSeconds - a.ratingUpdateTimeSeconds)
        .slice(0, recentLimit);
      const byScope = buildScopeBreakdown(scopeStats);

      return {
        lookbackDays,
        contestCount: contestMap.size,
        participantCount,
        topContests,
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
        topContests: [],
        recentContests: [],
        byScope: createScopeBreakdown(),
        participants: [],
      };
    }
  }

  async getRatingChangeSummaryForRoster(
    roster: RosterEntry[],
    options?: {
      lookbackDays?: number;
      limit?: number;
      scope?: ContestScopeFilter;
    }
  ): Promise<GuildRatingChangeSummary> {
    const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const limit = options?.limit ?? DEFAULT_DELTA_LIMIT;
    const scopeFilter = options?.scope ?? "all";
    const { handles, rosterMap } = this.buildRosterLookup(roster);
    if (handles.length === 0) {
      return {
        lookbackDays,
        contestCount: 0,
        participantCount: 0,
        totalDelta: 0,
        lastContestAt: null,
        topGainers: [],
        topLosers: [],
      };
    }

    try {
      const rows = await this.loadRatingChangeRows(handles, rosterMap);

      const cutoffSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
      const contestScopes = scopeFilter === "all" ? null : await this.loadContestScopeMap();
      const contestMap = new Map<number, number>();
      const participants = new Map<string, RatingChangeParticipantSummary>();
      let lastContestAt: number | null = null;
      let totalDelta = 0;

      for (const row of rows) {
        const rosterEntry = rosterMap.get(row.handle);
        if (!rosterEntry) {
          continue;
        }
        const changes = parseRatingChangesPayload(row.payload);
        const contestIds = new Set<number>();
        let participantDelta = 0;
        let participantLastContestAt: number | null = null;

        for (const change of changes) {
          if (change.ratingUpdateTimeSeconds < cutoffSeconds) {
            continue;
          }
          const contestScope = resolveContestScope(contestScopes, change.contestId);
          if (!matchesScope(scopeFilter, contestScope)) {
            continue;
          }
          const delta = change.newRating - change.oldRating;
          participantDelta += delta;
          totalDelta += delta;
          contestIds.add(change.contestId);
          contestMap.set(
            change.contestId,
            Math.max(contestMap.get(change.contestId) ?? 0, change.ratingUpdateTimeSeconds)
          );
          if (
            participantLastContestAt === null ||
            change.ratingUpdateTimeSeconds > participantLastContestAt
          ) {
            participantLastContestAt = change.ratingUpdateTimeSeconds;
          }
          if (lastContestAt === null || change.ratingUpdateTimeSeconds > lastContestAt) {
            lastContestAt = change.ratingUpdateTimeSeconds;
          }
        }

        if (contestIds.size > 0) {
          participants.set(row.handle, {
            userId: rosterEntry.userId,
            handle: rosterEntry.handle,
            contestCount: contestIds.size,
            delta: participantDelta,
            lastContestAt: participantLastContestAt,
          });
        }
      }

      const participantList = Array.from(participants.values());
      const topGainers = participantList
        .filter((entry) => entry.delta > 0)
        .sort(sortDeltaDescending)
        .slice(0, limit);
      const topLosers = participantList
        .filter((entry) => entry.delta < 0)
        .sort(sortDeltaAscending)
        .slice(0, limit);

      return {
        lookbackDays,
        contestCount: contestMap.size,
        participantCount: participants.size,
        totalDelta,
        lastContestAt,
        topGainers,
        topLosers,
      };
    } catch (error) {
      logError(`Database error (rating change summary): ${String(error)}`);
      return {
        lookbackDays,
        contestCount: 0,
        participantCount: 0,
        totalDelta: 0,
        lastContestAt: null,
        topGainers: [],
        topLosers: [],
      };
    }
  }

  private buildRosterLookup(roster: RosterEntry[]) {
    const handles = roster.map((row) => normalizeHandleKey(row.handle)).filter(Boolean);
    const rosterMap = new Map(
      roster.map((row) => [
        normalizeHandleKey(row.handle),
        { userId: row.userId, handle: row.handle },
      ])
    );
    return { handles, rosterMap };
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
        new Set(handleRows.map((row) => normalizeHandleKey(row.handle)).filter(Boolean))
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

      const handleMap = new Map(handles.map((handle) => [normalizeHandleKey(handle), { handle }]));
      const rows = await this.loadRatingChangeRows(handles, handleMap);

      const cutoffSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
      const contestScopes = await this.loadContestScopeMap();
      const contestMap = new Map<number, number>();
      const scopeStats = createScopeStats();
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
          this.updateScopeStats(
            scopeStats,
            scope,
            change.contestId,
            change.ratingUpdateTimeSeconds,
            row.handle
          );
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
        byScope: buildScopeBreakdown(scopeStats),
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

  private updateScopeStats(
    stats: ScopeStats,
    scope: ContestScope,
    contestId: number,
    ratingUpdateTimeSeconds: number,
    handle: string
  ): void {
    stats.scopeParticipants[scope].add(handle);
    if (
      stats.scopeLastContest[scope] === null ||
      ratingUpdateTimeSeconds > stats.scopeLastContest[scope]
    ) {
      stats.scopeLastContest[scope] = ratingUpdateTimeSeconds;
    }
    const scopedMap = stats.scopeContestMap[scope];
    const scopedExisting = scopedMap.get(contestId);
    if (!scopedExisting || ratingUpdateTimeSeconds > scopedExisting) {
      scopedMap.set(contestId, ratingUpdateTimeSeconds);
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
            if (!contest) {
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

  private async loadRatingChangeRows(
    handles: string[],
    handleMap: Map<string, { handle: string }>
  ): Promise<Array<{ handle: string; payload: string }>> {
    await this.refreshMissingRatingChanges(handles, handleMap);
    return this.db
      .selectFrom("cf_rating_changes")
      .select(["handle", "payload"])
      .where("handle", "in", handles)
      .execute();
  }

  private async refreshMissingRatingChanges(
    handles: string[],
    handleMap: Map<string, { handle: string }>
  ): Promise<void> {
    const normalized = handles.map((handle) => normalizeHandleKey(handle)).filter(Boolean);
    if (normalized.length === 0) {
      return;
    }
    const uniqueHandles = Array.from(new Set(normalized));
    const cached = await this.db
      .selectFrom("cf_rating_changes")
      .select("handle")
      .where("handle", "in", uniqueHandles)
      .execute();
    const cachedSet = new Set(cached.map((row) => normalizeHandleKey(row.handle)));
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
