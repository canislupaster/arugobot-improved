import { sql, type Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError } from "../utils/logger.js";

import type { ContestActivityService } from "./contestActivity.js";
import type { GuildSettingsService } from "./guildSettings.js";
import type { StoreService } from "./store.js";

type ServerStats = Awaited<ReturnType<StoreService["getServerStats"]>>;
type RatingEntry = NonNullable<Awaited<ReturnType<StoreService["getLeaderboard"]>>>[number];
type SolveEntry = NonNullable<Awaited<ReturnType<StoreService["getSolveLeaderboard"]>>>[number];
type RosterEntry = Awaited<ReturnType<StoreService["getServerRoster"]>>[number];
type ChallengeActivitySummary = Awaited<ReturnType<StoreService["getChallengeActivity"]>>;

export type GlobalOverview = {
  guildCount: number;
  linkedUsers: number;
  activeChallenges: number;
  completedChallenges: number;
  totalChallenges: number;
  activeTournaments: number;
  completedTournaments: number;
  totalTournaments: number;
  lastChallengeAt: string | null;
  lastTournamentAt: string | null;
  contestActivity: {
    lookbackDays: number;
    contestCount: number;
    participantCount: number;
    lastContestAt: number | null;
  };
};

export type GuildSummary = {
  guildId: string;
  linkedUsers: number;
  activeChallenges: number;
  completedChallenges: number;
  lastChallengeAt: string | null;
};

export type TournamentSummary = {
  id: string;
  status: string;
  format: string;
  lengthMinutes: number;
  roundCount: number;
  participantCount: number;
  updatedAt: string;
};

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

export type GuildOverview = {
  guildId: string;
  stats: ServerStats;
  ratingLeaderboard: RatingEntry[];
  solveLeaderboard: SolveEntry[];
  roster: RosterEntry[];
  activity: ChallengeActivitySummary;
  contestActivity: ContestActivitySummary;
  tournaments: TournamentSummary[];
  hasData: boolean;
};

const DEFAULT_ACTIVITY_DAYS = 30;
const DEFAULT_TOURNAMENT_LIMIT = 3;
const DEFAULT_CONTEST_ACTIVITY_DAYS = 90;

export class WebsiteService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly store: StoreService,
    private readonly settings: GuildSettingsService,
    private readonly contestActivity: ContestActivityService
  ) {}

  async getGlobalOverview(): Promise<GlobalOverview> {
    try {
      const publicGuildIds = await this.settings.listPublicGuildIds();
      if (publicGuildIds.length === 0) {
        return {
          guildCount: 0,
          linkedUsers: 0,
          activeChallenges: 0,
          completedChallenges: 0,
          totalChallenges: 0,
          activeTournaments: 0,
          completedTournaments: 0,
          totalTournaments: 0,
          lastChallengeAt: null,
          lastTournamentAt: null,
          contestActivity: {
            lookbackDays: DEFAULT_CONTEST_ACTIVITY_DAYS,
            contestCount: 0,
            participantCount: 0,
            lastContestAt: null,
          },
        };
      }

      const guildCountRow = await this.db
        .selectFrom("users")
        .select(sql<number>`count(distinct server_id)`.as("count"))
        .where("server_id", "in", publicGuildIds)
        .executeTakeFirst();
      const linkedUsersRow = await this.db
        .selectFrom("users")
        .select(({ fn }) => fn.count<string>("user_id").as("count"))
        .where("server_id", "in", publicGuildIds)
        .executeTakeFirst();
      const activeChallengesRow = await this.db
        .selectFrom("challenges")
        .select(({ fn }) => fn.count<string>("id").as("count"))
        .where("status", "=", "active")
        .where("server_id", "in", publicGuildIds)
        .executeTakeFirst();
      const completedChallengesRow = await this.db
        .selectFrom("challenges")
        .select(({ fn }) => fn.count<string>("id").as("count"))
        .where("status", "=", "completed")
        .where("server_id", "in", publicGuildIds)
        .executeTakeFirst();
      const totalChallengesRow = await this.db
        .selectFrom("challenges")
        .select(({ fn }) => fn.count<string>("id").as("count"))
        .where("server_id", "in", publicGuildIds)
        .executeTakeFirst();
      const lastChallengeRow = await this.db
        .selectFrom("challenges")
        .select(({ fn }) => fn.max<string>("updated_at").as("last"))
        .where("server_id", "in", publicGuildIds)
        .executeTakeFirst();

      const activeTournamentsRow = await this.db
        .selectFrom("tournaments")
        .select(({ fn }) => fn.count<string>("id").as("count"))
        .where("status", "=", "active")
        .where("guild_id", "in", publicGuildIds)
        .executeTakeFirst();
      const completedTournamentsRow = await this.db
        .selectFrom("tournaments")
        .select(({ fn }) => fn.count<string>("id").as("count"))
        .where("status", "=", "completed")
        .where("guild_id", "in", publicGuildIds)
        .executeTakeFirst();
      const totalTournamentsRow = await this.db
        .selectFrom("tournaments")
        .select(({ fn }) => fn.count<string>("id").as("count"))
        .where("guild_id", "in", publicGuildIds)
        .executeTakeFirst();
      const lastTournamentRow = await this.db
        .selectFrom("tournaments")
        .select(({ fn }) => fn.max<string>("updated_at").as("last"))
        .where("guild_id", "in", publicGuildIds)
        .executeTakeFirst();

      const contestActivity = await this.contestActivity.getGlobalContestActivity(
        publicGuildIds,
        DEFAULT_CONTEST_ACTIVITY_DAYS
      );

      return {
        guildCount: Number(guildCountRow?.count ?? 0),
        linkedUsers: Number(linkedUsersRow?.count ?? 0),
        activeChallenges: Number(activeChallengesRow?.count ?? 0),
        completedChallenges: Number(completedChallengesRow?.count ?? 0),
        totalChallenges: Number(totalChallengesRow?.count ?? 0),
        activeTournaments: Number(activeTournamentsRow?.count ?? 0),
        completedTournaments: Number(completedTournamentsRow?.count ?? 0),
        totalTournaments: Number(totalTournamentsRow?.count ?? 0),
        lastChallengeAt: lastChallengeRow?.last ?? null,
        lastTournamentAt: lastTournamentRow?.last ?? null,
        contestActivity,
      };
    } catch (error) {
      logError(`Database error (global overview): ${String(error)}`);
      return {
        guildCount: 0,
        linkedUsers: 0,
        activeChallenges: 0,
        completedChallenges: 0,
        totalChallenges: 0,
        activeTournaments: 0,
        completedTournaments: 0,
        totalTournaments: 0,
        lastChallengeAt: null,
        lastTournamentAt: null,
        contestActivity: {
          lookbackDays: DEFAULT_CONTEST_ACTIVITY_DAYS,
          contestCount: 0,
          participantCount: 0,
          lastContestAt: null,
        },
      };
    }
  }

  async listGuildSummaries(limit = 20): Promise<GuildSummary[]> {
    try {
      const publicGuildIds = await this.settings.listPublicGuildIds();
      if (publicGuildIds.length === 0) {
        return [];
      }

      const userRows = await this.db
        .selectFrom("users")
        .select(({ fn, ref }) => [
          ref("server_id").as("server_id"),
          fn.count<string>("user_id").as("count"),
        ])
        .where("server_id", "in", publicGuildIds)
        .groupBy("server_id")
        .execute();

      if (userRows.length === 0) {
        return [];
      }

      const activeChallengeRows = await this.db
        .selectFrom("challenges")
        .select(({ fn, ref }) => [
          ref("server_id").as("server_id"),
          fn.count<string>("id").as("count"),
        ])
        .where("status", "=", "active")
        .where("server_id", "in", publicGuildIds)
        .groupBy("server_id")
        .execute();
      const completedChallengeRows = await this.db
        .selectFrom("challenges")
        .select(({ fn, ref }) => [
          ref("server_id").as("server_id"),
          fn.count<string>("id").as("count"),
        ])
        .where("status", "=", "completed")
        .where("server_id", "in", publicGuildIds)
        .groupBy("server_id")
        .execute();
      const lastChallengeRows = await this.db
        .selectFrom("challenges")
        .select(({ fn, ref }) => [
          ref("server_id").as("server_id"),
          fn.max<string>("updated_at").as("last"),
        ])
        .where("server_id", "in", publicGuildIds)
        .groupBy("server_id")
        .execute();

      const activeMap = new Map(
        activeChallengeRows.map((row) => [row.server_id, Number(row.count ?? 0)])
      );
      const completedMap = new Map(
        completedChallengeRows.map((row) => [row.server_id, Number(row.count ?? 0)])
      );
      const lastMap = new Map(lastChallengeRows.map((row) => [row.server_id, row.last ?? null]));

      return userRows
        .map((row) => ({
          guildId: row.server_id,
          linkedUsers: Number(row.count ?? 0),
          activeChallenges: activeMap.get(row.server_id) ?? 0,
          completedChallenges: completedMap.get(row.server_id) ?? 0,
          lastChallengeAt: lastMap.get(row.server_id) ?? null,
        }))
        .sort(
          (a, b) =>
            b.completedChallenges - a.completedChallenges ||
            b.linkedUsers - a.linkedUsers ||
            a.guildId.localeCompare(b.guildId)
        )
        .slice(0, Math.max(1, limit));
    } catch (error) {
      logError(`Database error (guild summary): ${String(error)}`);
      return [];
    }
  }

  async getGuildOverview(
    guildId: string,
    options?: { activityDays?: number; tournamentLimit?: number; contestActivityDays?: number }
  ): Promise<GuildOverview | null> {
    try {
      const isPublic = await this.settings.isDashboardPublic(guildId);
      if (!isPublic) {
        return null;
      }

      const stats = await this.store.getServerStats(guildId);
      const totalChallengesRow = await this.db
        .selectFrom("challenges")
        .select(({ fn }) => fn.count<string>("id").as("count"))
        .where("server_id", "=", guildId)
        .executeTakeFirst();
      const totalChallenges = Number(totalChallengesRow?.count ?? 0);
      const hasData = stats.userCount > 0 || totalChallenges > 0;
      if (!hasData) {
        return null;
      }

      const ratingLeaderboard = (await this.store.getLeaderboard(guildId)) ?? [];
      const solveLeaderboard = (await this.store.getSolveLeaderboard(guildId)) ?? [];
      const roster = await this.store.getServerRoster(guildId);

      const activityDays = options?.activityDays ?? DEFAULT_ACTIVITY_DAYS;
      const sinceIso = new Date(Date.now() - activityDays * 24 * 60 * 60 * 1000).toISOString();
      const activity = await this.store.getChallengeActivity(guildId, sinceIso, 5);

      const contestActivityDays = options?.contestActivityDays ?? DEFAULT_CONTEST_ACTIVITY_DAYS;
      const contestActivity = await this.contestActivity.getContestActivityForRoster(roster, {
        lookbackDays: contestActivityDays,
        recentLimit: 4,
      });

      const tournaments = await this.db
        .selectFrom("tournaments")
        .leftJoin(
          "tournament_participants",
          "tournament_participants.tournament_id",
          "tournaments.id"
        )
        .select(({ fn, ref }) => [
          ref("tournaments.id").as("id"),
          ref("tournaments.status").as("status"),
          ref("tournaments.format").as("format"),
          ref("tournaments.length_minutes").as("length_minutes"),
          ref("tournaments.round_count").as("round_count"),
          ref("tournaments.updated_at").as("updated_at"),
          fn.count<string>("tournament_participants.user_id").as("participant_count"),
        ])
        .where("tournaments.guild_id", "=", guildId)
        .groupBy("tournaments.id")
        .orderBy("tournaments.updated_at", "desc")
        .limit(Math.max(1, options?.tournamentLimit ?? DEFAULT_TOURNAMENT_LIMIT))
        .execute();

      return {
        guildId,
        stats,
        ratingLeaderboard,
        solveLeaderboard,
        roster,
        activity,
        tournaments: tournaments.map((row) => ({
          id: row.id,
          status: row.status,
          format: row.format,
          lengthMinutes: Number(row.length_minutes ?? 0),
          roundCount: Number(row.round_count ?? 0),
          participantCount: Number(row.participant_count ?? 0),
          updatedAt: row.updated_at,
        })),
        contestActivity,
        hasData: true,
      };
    } catch (error) {
      logError(`Database error (guild overview): ${String(error)}`);
      return null;
    }
  }

  // contest activity lives in ContestActivityService
}
