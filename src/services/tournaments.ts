import { randomUUID } from "node:crypto";

import { ChannelType, type Client, type GuildTextBasedChannel } from "discord.js";
import { type ExpressionBuilder, type Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError, logInfo } from "../utils/logger.js";
import {
  filterProblemsByRatingRanges,
  filterProblemsByTags,
  parseTagFilters,
  selectRandomProblem,
} from "../utils/problemSelection.js";
import type { RatingRange } from "../utils/ratingRanges.js";
import {
  buildEliminationPairings,
  buildSwissPairings,
  resolveMatchOutcome,
  type PairingHistory,
  type TournamentPairing,
  type TournamentPairingParticipant,
} from "../utils/tournament.js";

import type { ChallengeCompletionNotifier, ChallengeService } from "./challenges.js";
import type { Problem, ProblemService } from "./problems.js";
import type { StoreService } from "./store.js";

export type TournamentFormat = "swiss" | "elimination";
export type TournamentStatus = "active" | "completed" | "cancelled";
export type TournamentRoundStatus = "active" | "completed";
export type Tournament = {
  id: string;
  guildId: string;
  channelId: string;
  hostUserId: string;
  format: TournamentFormat;
  status: TournamentStatus;
  lengthMinutes: number;
  roundCount: number;
  currentRound: number;
  ratingRanges: RatingRange[];
  tags: string;
};

export type TournamentParticipant = {
  userId: string;
  seed: number;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  eliminated: boolean;
};

export type TournamentRound = {
  id: string;
  roundNumber: number;
  status: TournamentRoundStatus;
  problem: Problem;
};

export type TournamentRoundSummary = {
  roundNumber: number;
  matchCount: number;
  byeCount: number;
  problem: Problem;
};

export type TournamentStartResult = {
  tournamentId: string;
  round: TournamentRoundSummary;
};

export type TournamentAdvanceResult =
  | { status: "no_active" }
  | { status: "round_incomplete"; roundNumber: number }
  | { status: "completed"; winnerId: string | null }
  | { status: "started"; round: TournamentRoundSummary }
  | { status: "error"; message: string };

export class TournamentService implements ChallengeCompletionNotifier {
  private lastError: { message: string; timestamp: string } | null = null;

  constructor(
    private db: Kysely<Database>,
    private problems: ProblemService,
    private store: StoreService,
    private challenges: ChallengeService
  ) {}

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async getActiveCount(): Promise<number> {
    const row = await this.db
      .selectFrom("tournaments")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("status", "=", "active")
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  async getActiveTournament(guildId: string): Promise<Tournament | null> {
    const row = await this.db
      .selectFrom("tournaments")
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    return this.mapTournament(row);
  }

  async listParticipants(tournamentId: string): Promise<TournamentParticipant[]> {
    const rows = await this.db
      .selectFrom("tournament_participants")
      .selectAll()
      .where("tournament_id", "=", tournamentId)
      .execute();
    return rows.map((row) => ({
      userId: row.user_id,
      seed: row.seed,
      score: row.score,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      eliminated: row.eliminated === 1,
    }));
  }

  async getCurrentRound(
    tournamentId: string,
    roundNumber: number
  ): Promise<TournamentRound | null> {
    const row = await this.db
      .selectFrom("tournament_rounds")
      .selectAll()
      .where("tournament_id", "=", tournamentId)
      .where("round_number", "=", roundNumber)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      roundNumber: row.round_number,
      status: row.status as TournamentRoundStatus,
      problem: {
        contestId: row.problem_contest_id,
        index: row.problem_index,
        name: row.problem_name,
        rating: row.problem_rating,
        tags: [],
      },
    };
  }

  async createTournament({
    guildId,
    channelId,
    hostUserId,
    format,
    lengthMinutes,
    roundCount,
    ratingRanges,
    tags,
    participants,
    client,
  }: {
    guildId: string;
    channelId: string;
    hostUserId: string;
    format: TournamentFormat;
    lengthMinutes: number;
    roundCount: number;
    ratingRanges: RatingRange[];
    tags: string;
    participants: string[];
    client: Client;
  }): Promise<TournamentStartResult> {
    const existing = await this.getActiveTournament(guildId);
    if (existing) {
      throw new Error("An active tournament already exists for this server.");
    }
    if (participants.length < 2) {
      throw new Error("At least two participants are required.");
    }

    const tournamentId = randomUUID();
    const nowIso = new Date().toISOString();
    await this.db
      .insertInto("tournaments")
      .values({
        id: tournamentId,
        guild_id: guildId,
        channel_id: channelId,
        host_user_id: hostUserId,
        format,
        status: "active",
        length_minutes: lengthMinutes,
        round_count: roundCount,
        current_round: 0,
        rating_ranges: JSON.stringify(ratingRanges),
        tags,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    const participantRows = participants.map((userId, index) => ({
      tournament_id: tournamentId,
      user_id: userId,
      seed: index + 1,
      score: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      eliminated: 0,
      created_at: nowIso,
      updated_at: nowIso,
    }));
    await this.db.insertInto("tournament_participants").values(participantRows).execute();

    const tournament = await this.getTournamentById(tournamentId);
    if (!tournament) {
      throw new Error("Failed to create tournament.");
    }

    const round = await this.startRound(tournament, client);
    logInfo("Tournament created.", { tournamentId, guildId, format, round: round.roundNumber });
    return { tournamentId, round };
  }

  async advanceTournament(guildId: string, client: Client): Promise<TournamentAdvanceResult> {
    const tournament = await this.getActiveTournament(guildId);
    if (!tournament) {
      return { status: "no_active" };
    }

    const currentRound = await this.getCurrentRound(tournament.id, tournament.currentRound);
    if (currentRound && currentRound.status !== "completed") {
      return { status: "round_incomplete", roundNumber: tournament.currentRound };
    }

    const remaining = await this.listActiveParticipants(tournament.id);
    if (tournament.format === "elimination" && remaining.length <= 1) {
      await this.completeTournament(tournament.id);
      return { status: "completed", winnerId: remaining[0]?.userId ?? null };
    }

    if (tournament.format === "swiss" && tournament.currentRound >= tournament.roundCount) {
      await this.completeTournament(tournament.id);
      const top = remaining.sort((a, b) => b.score - a.score)[0];
      return { status: "completed", winnerId: top?.userId ?? null };
    }

    try {
      const round = await this.startRound(tournament, client);
      return { status: "started", round };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError("Failed to advance tournament.", { error: message, tournamentId: tournament.id });
      return { status: "error", message };
    }
  }

  async cancelTournament(guildId: string, cancelledBy: string, client: Client): Promise<boolean> {
    const tournament = await this.getActiveTournament(guildId);
    if (!tournament) {
      return false;
    }

    const matches = await this.db
      .selectFrom("tournament_matches")
      .select(["challenge_id"])
      .where("tournament_id", "=", tournament.id)
      .where("status", "=", "pending")
      .execute();

    for (const match of matches) {
      if (match.challenge_id) {
        await this.challenges.cancelChallenge(match.challenge_id, cancelledBy, client);
      }
    }

    await this.db
      .updateTable("tournaments")
      .set({ status: "cancelled", updated_at: new Date().toISOString() })
      .where("id", "=", tournament.id)
      .execute();
    return true;
  }

  async onChallengeCompleted(challengeId: string): Promise<void> {
    const match = await this.db
      .selectFrom("tournament_matches")
      .selectAll()
      .where("challenge_id", "=", challengeId)
      .executeTakeFirst();
    if (!match || match.status !== "pending") {
      return;
    }

    const tournamentRow = await this.db
      .selectFrom("tournaments")
      .select(["id", "format", "status"])
      .where("id", "=", match.tournament_id)
      .executeTakeFirst();
    if (!tournamentRow || tournamentRow.status !== "active") {
      return;
    }

    const participants = await this.db
      .selectFrom("challenge_participants")
      .select(["user_id", "solved_at"])
      .where("challenge_id", "=", challengeId)
      .execute();
    if (participants.length === 0) {
      return;
    }

    const seedRows = await this.db
      .selectFrom("tournament_participants")
      .select(["user_id", "seed"])
      .where("tournament_id", "=", match.tournament_id)
      .execute();
    const seedMap = new Map(seedRows.map((row) => [row.user_id, row.seed]));

    const outcome = resolveMatchOutcome(
      participants.map((participant) => ({
        userId: participant.user_id,
        solvedAt: participant.solved_at ?? null,
      })),
      seedMap,
      tournamentRow.format === "swiss"
    );

    await this.applyMatchOutcome({
      tournamentId: match.tournament_id,
      matchId: match.id,
      roundId: match.round_id,
      format: tournamentRow.format as TournamentFormat,
      outcome,
      players: [match.player1_id, match.player2_id],
    });
  }

  private async getTournamentById(tournamentId: string): Promise<Tournament | null> {
    const row = await this.db
      .selectFrom("tournaments")
      .selectAll()
      .where("id", "=", tournamentId)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    return this.mapTournament(row);
  }

  private mapTournament(row: {
    id: string;
    guild_id: string;
    channel_id: string;
    host_user_id: string;
    format: string;
    status: string;
    length_minutes: number;
    round_count: number;
    current_round: number;
    rating_ranges: string;
    tags: string;
  }): Tournament {
    const ratingRanges = this.parseRatingRanges(row.rating_ranges);
    return {
      id: row.id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      hostUserId: row.host_user_id,
      format: row.format as TournamentFormat,
      status: row.status as TournamentStatus,
      lengthMinutes: row.length_minutes,
      roundCount: row.round_count,
      currentRound: row.current_round,
      ratingRanges,
      tags: row.tags,
    };
  }

  private parseRatingRanges(raw: string): RatingRange[] {
    try {
      const parsed = JSON.parse(raw) as RatingRange[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (range) =>
          Number.isFinite(range.min) && Number.isFinite(range.max) && range.min <= range.max
      );
    } catch {
      return [];
    }
  }

  private async listActiveParticipants(tournamentId: string): Promise<TournamentParticipant[]> {
    const participants = await this.listParticipants(tournamentId);
    return participants.filter((participant) => !participant.eliminated);
  }

  private async startRound(
    tournament: Tournament,
    client: Client
  ): Promise<TournamentRoundSummary> {
    const activeParticipants = await this.listActiveParticipants(tournament.id);
    if (activeParticipants.length < 2) {
      throw new Error("Not enough participants to start a round.");
    }

    const problem = await this.selectRoundProblem(tournament, activeParticipants);
    const roundNumber = tournament.currentRound + 1;
    const roundId = randomUUID();
    const nowIso = new Date().toISOString();

    await this.db
      .insertInto("tournament_rounds")
      .values({
        id: roundId,
        tournament_id: tournament.id,
        round_number: roundNumber,
        status: "active",
        problem_contest_id: problem.contestId,
        problem_index: problem.index,
        problem_name: problem.name,
        problem_rating: problem.rating ?? 0,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    const pairings = await this.buildPairings(tournament, activeParticipants);
    const channel = await this.resolveChannel(client, tournament.channelId);
    if (!channel) {
      throw new Error("Tournament channel is missing or invalid.");
    }

    let matchNumber = 1;
    let byeCount = 0;
    let pendingCount = 0;
    for (const pairing of pairings) {
      if (!pairing.player2Id) {
        byeCount += 1;
        await this.recordByeMatch(tournament.id, roundId, matchNumber, pairing.player1Id);
        matchNumber += 1;
        continue;
      }
      pendingCount += 1;
      const challengeId = await this.createMatchChallenge({
        tournament,
        problem,
        channel,
        participants: [pairing.player1Id, pairing.player2Id],
      });
      await this.db
        .insertInto("tournament_matches")
        .values({
          id: randomUUID(),
          tournament_id: tournament.id,
          round_id: roundId,
          match_number: matchNumber,
          challenge_id: challengeId,
          player1_id: pairing.player1Id,
          player2_id: pairing.player2Id,
          winner_id: null,
          status: "pending",
          created_at: nowIso,
          updated_at: nowIso,
        })
        .execute();
      matchNumber += 1;
    }

    await this.db
      .updateTable("tournaments")
      .set({ current_round: roundNumber, updated_at: nowIso })
      .where("id", "=", tournament.id)
      .execute();

    if (pendingCount === 0) {
      await this.db
        .updateTable("tournament_rounds")
        .set({ status: "completed", updated_at: nowIso })
        .where("id", "=", roundId)
        .execute();
    }

    return {
      roundNumber,
      matchCount: pairings.length,
      byeCount,
      problem,
    };
  }

  private async createMatchChallenge({
    tournament,
    problem,
    channel,
    participants,
  }: {
    tournament: Tournament;
    problem: Problem;
    channel: GuildTextBasedChannel;
    participants: [string, string];
  }): Promise<string> {
    const startTime = Math.floor(Date.now() / 1000);
    const challengeParticipants = participants.map((userId, index) => ({
      userId,
      position: index,
      solvedAt: null,
      ratingBefore: null,
      ratingDelta: null,
    }));
    const embed = await this.challenges.buildActiveEmbed({
      serverId: tournament.guildId,
      problem: {
        contestId: problem.contestId,
        index: problem.index,
        name: problem.name,
        rating: problem.rating ?? 0,
      },
      lengthMinutes: tournament.lengthMinutes,
      timeLeftSeconds: tournament.lengthMinutes * 60,
      participants: challengeParticipants,
    });

    const message = await channel.send({ embeds: [embed] });
    return await this.challenges.createChallenge({
      serverId: tournament.guildId,
      channelId: tournament.channelId,
      messageId: message.id,
      hostUserId: tournament.hostUserId,
      problem: {
        contestId: problem.contestId,
        index: problem.index,
        name: problem.name,
        rating: problem.rating ?? 0,
      },
      lengthMinutes: tournament.lengthMinutes,
      participants,
      startedAt: startTime,
    });
  }

  private async resolveChannel(
    client: Client,
    channelId: string
  ): Promise<GuildTextBasedChannel | null> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      return null;
    }
    return channel;
  }

  private async recordByeMatch(
    tournamentId: string,
    roundId: string,
    matchNumber: number,
    playerId: string
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db
      .insertInto("tournament_matches")
      .values({
        id: randomUUID(),
        tournament_id: tournamentId,
        round_id: roundId,
        match_number: matchNumber,
        challenge_id: null,
        player1_id: playerId,
        player2_id: null,
        winner_id: playerId,
        status: "bye",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await this.db
      .updateTable("tournament_participants")
      .set({
        score: (eb) => eb("score", "+", 1),
        wins: (eb) => eb("wins", "+", 1),
        updated_at: nowIso,
      })
      .where("tournament_id", "=", tournamentId)
      .where("user_id", "=", playerId)
      .execute();
  }

  private async buildPairings(
    tournament: Tournament,
    participants: TournamentParticipant[]
  ): Promise<TournamentPairing[]> {
    const seeds: TournamentPairingParticipant[] = participants.map((participant) => ({
      userId: participant.userId,
      score: participant.score,
      seed: participant.seed,
    }));

    if (tournament.format === "elimination") {
      return buildEliminationPairings(seeds);
    }

    const history = await this.getPairingHistory(tournament.id);
    return buildSwissPairings(seeds, history);
  }

  private async getPairingHistory(tournamentId: string): Promise<PairingHistory> {
    const rows = await this.db
      .selectFrom("tournament_matches")
      .select(["player1_id", "player2_id"])
      .where("tournament_id", "=", tournamentId)
      .where("player2_id", "is not", null)
      .execute();
    const history: PairingHistory = new Map();
    for (const row of rows) {
      if (!row.player2_id) {
        continue;
      }
      const listA = history.get(row.player1_id) ?? new Set<string>();
      listA.add(row.player2_id);
      history.set(row.player1_id, listA);
      const listB = history.get(row.player2_id) ?? new Set<string>();
      listB.add(row.player1_id);
      history.set(row.player2_id, listB);
    }
    return history;
  }

  private async selectRoundProblem(
    tournament: Tournament,
    participants: TournamentParticipant[]
  ): Promise<Problem> {
    const problems = await this.problems.ensureProblemsLoaded();
    if (problems.length === 0) {
      throw new Error("Problem cache not ready.");
    }

    const tagFilters = parseTagFilters(tournament.tags);
    const rated = filterProblemsByRatingRanges(problems, tournament.ratingRanges);
    const candidates = filterProblemsByTags(rated, tagFilters);
    if (candidates.length === 0) {
      throw new Error("No problems match the tournament filters.");
    }

    const excludedIds = new Set<string>();
    const used = await this.db
      .selectFrom("tournament_rounds")
      .select(["problem_contest_id", "problem_index"])
      .where("tournament_id", "=", tournament.id)
      .execute();
    for (const row of used) {
      excludedIds.add(`${row.problem_contest_id}${row.problem_index}`);
    }

    for (const participant of participants) {
      const history = await this.store.getHistoryList(tournament.guildId, participant.userId);
      for (const problemId of history) {
        excludedIds.add(problemId);
      }
    }

    for (const participant of participants) {
      const handle = await this.store.getHandle(tournament.guildId, participant.userId);
      if (!handle) {
        throw new Error("Missing handle data for a participant.");
      }
      const solved = await this.store.getSolvedProblems(handle);
      if (!solved) {
        throw new Error("Unable to fetch solved problems for tournament participants.");
      }
      for (const solvedId of solved) {
        excludedIds.add(solvedId);
      }
    }

    const problem = selectRandomProblem(candidates, excludedIds);
    if (!problem) {
      throw new Error("No unsolved problems found for this tournament.");
    }
    return problem;
  }

  private async applyMatchOutcome({
    tournamentId,
    matchId,
    roundId,
    format,
    outcome,
    players,
  }: {
    tournamentId: string;
    matchId: string;
    roundId: string;
    format: TournamentFormat;
    outcome: { winnerId: string | null; loserId: string | null; isDraw: boolean };
    players: Array<string | null>;
  }): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db
      .updateTable("tournament_matches")
      .set({
        winner_id: outcome.winnerId,
        status: "completed",
        updated_at: nowIso,
      })
      .where("id", "=", matchId)
      .execute();

    if (outcome.isDraw) {
      for (const playerId of players) {
        if (playerId) {
          await this.updateParticipantScore(tournamentId, playerId, 0.5, "draw");
        }
      }
    } else {
      await this.updateParticipantScore(tournamentId, outcome.winnerId, 1, "win");
      await this.updateParticipantScore(tournamentId, outcome.loserId, 0, "loss");
      if (format === "elimination" && outcome.loserId) {
        await this.db
          .updateTable("tournament_participants")
          .set({ eliminated: 1, updated_at: nowIso })
          .where("tournament_id", "=", tournamentId)
          .where("user_id", "=", outcome.loserId)
          .execute();
      }
    }

    const remaining = await this.db
      .selectFrom("tournament_matches")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("round_id", "=", roundId)
      .where("status", "=", "pending")
      .executeTakeFirst();
    if ((remaining?.count ?? 0) === 0) {
      await this.db
        .updateTable("tournament_rounds")
        .set({ status: "completed", updated_at: nowIso })
        .where("id", "=", roundId)
        .execute();
    }
  }

  private async updateParticipantScore(
    tournamentId: string,
    userId: string | null,
    points: number,
    outcome: "win" | "loss" | "draw"
  ): Promise<void> {
    if (!userId) {
      return;
    }
    const nowIso = new Date().toISOString();
    await this.db
      .updateTable("tournament_participants")
      .set({
        score: (eb: ExpressionBuilder<Database, "tournament_participants">) =>
          eb("score", "+", points),
        updated_at: nowIso,
      })
      .where("tournament_id", "=", tournamentId)
      .where("user_id", "=", userId)
      .execute();

    if (outcome === "win") {
      await this.db
        .updateTable("tournament_participants")
        .set({
          wins: (eb: ExpressionBuilder<Database, "tournament_participants">) => eb("wins", "+", 1),
          updated_at: nowIso,
        })
        .where("tournament_id", "=", tournamentId)
        .where("user_id", "=", userId)
        .execute();
    } else if (outcome === "loss") {
      await this.db
        .updateTable("tournament_participants")
        .set({
          losses: (eb: ExpressionBuilder<Database, "tournament_participants">) =>
            eb("losses", "+", 1),
          updated_at: nowIso,
        })
        .where("tournament_id", "=", tournamentId)
        .where("user_id", "=", userId)
        .execute();
    } else {
      await this.db
        .updateTable("tournament_participants")
        .set({
          draws: (eb: ExpressionBuilder<Database, "tournament_participants">) =>
            eb("draws", "+", 1),
          updated_at: nowIso,
        })
        .where("tournament_id", "=", tournamentId)
        .where("user_id", "=", userId)
        .execute();
    }
  }

  private async completeTournament(tournamentId: string): Promise<void> {
    await this.db
      .updateTable("tournaments")
      .set({ status: "completed", updated_at: new Date().toISOString() })
      .where("id", "=", tournamentId)
      .execute();
  }
}
