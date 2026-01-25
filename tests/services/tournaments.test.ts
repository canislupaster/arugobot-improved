import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import type { ChallengeService } from "../../src/services/challenges.js";
import type { CodeforcesClient } from "../../src/services/codeforces.js";
import { NoopCodeforcesCache } from "../../src/services/codeforcesCache.js";
import { ProblemService } from "../../src/services/problems.js";
import { StoreService } from "../../src/services/store.js";
import { TournamentService } from "../../src/services/tournaments.js";

describe("TournamentService", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("records match results and updates standings", async () => {
    const service = new TournamentService(db, {} as never, {} as never, {} as never);
    const tournamentId = "tournament-1";
    const roundId = "round-1";
    const matchId = "match-1";
    const challengeId = "challenge-1";
    const nowIso = new Date().toISOString();

    await db
      .insertInto("tournaments")
      .values({
        id: tournamentId,
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "swiss",
        status: "active",
        length_minutes: 40,
        round_count: 3,
        current_round: 1,
        rating_ranges: "[]",
        tags: "",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_participants")
      .values([
        {
          tournament_id: tournamentId,
          user_id: "user-1",
          seed: 1,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-2",
          seed: 2,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    await db
      .insertInto("tournament_rounds")
      .values({
        id: roundId,
        tournament_id: tournamentId,
        round_number: 1,
        status: "active",
        problem_contest_id: 1000,
        problem_index: "A",
        problem_name: "Test",
        problem_rating: 1200,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_matches")
      .values({
        id: matchId,
        tournament_id: tournamentId,
        round_id: roundId,
        match_number: 1,
        challenge_id: challengeId,
        player1_id: "user-1",
        player2_id: "user-2",
        winner_id: null,
        status: "pending",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("challenge_participants")
      .values([
        {
          challenge_id: challengeId,
          user_id: "user-1",
          position: 0,
          solved_at: 100,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          challenge_id: challengeId,
          user_id: "user-2",
          position: 1,
          solved_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    await service.onChallengeCompleted(challengeId);

    const match = await db
      .selectFrom("tournament_matches")
      .select(["winner_id", "status"])
      .where("id", "=", matchId)
      .executeTakeFirstOrThrow();
    expect(match.winner_id).toBe("user-1");
    expect(match.status).toBe("completed");

    const winner = await db
      .selectFrom("tournament_participants")
      .select(["score", "wins"])
      .where("tournament_id", "=", tournamentId)
      .where("user_id", "=", "user-1")
      .executeTakeFirstOrThrow();
    expect(winner.score).toBe(1);
    expect(winner.wins).toBe(1);

    const loser = await db
      .selectFrom("tournament_participants")
      .select(["score", "losses"])
      .where("tournament_id", "=", tournamentId)
      .where("user_id", "=", "user-2")
      .executeTakeFirstOrThrow();
    expect(loser.score).toBe(0);
    expect(loser.losses).toBe(1);

    const round = await db
      .selectFrom("tournament_rounds")
      .select("status")
      .where("id", "=", roundId)
      .executeTakeFirstOrThrow();
    expect(round.status).toBe("completed");
  });

  it("computes swiss standings with tiebreakers", async () => {
    const service = new TournamentService(db, {} as never, {} as never, {} as never);
    const tournamentId = "tournament-2";
    const roundId = "round-2";
    const nowIso = new Date().toISOString();

    await db
      .insertInto("tournaments")
      .values({
        id: tournamentId,
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "swiss",
        status: "active",
        length_minutes: 40,
        round_count: 3,
        current_round: 1,
        rating_ranges: "[]",
        tags: "",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_participants")
      .values([
        {
          tournament_id: tournamentId,
          user_id: "user-1",
          seed: 1,
          score: 1,
          wins: 1,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-2",
          seed: 2,
          score: 1,
          wins: 1,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-3",
          seed: 3,
          score: 0.5,
          wins: 0,
          losses: 0,
          draws: 1,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-4",
          seed: 4,
          score: 0,
          wins: 0,
          losses: 1,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    await db
      .insertInto("tournament_rounds")
      .values({
        id: roundId,
        tournament_id: tournamentId,
        round_number: 1,
        status: "active",
        problem_contest_id: 1000,
        problem_index: "A",
        problem_name: "Test",
        problem_rating: 1200,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_matches")
      .values([
        {
          id: "match-1",
          tournament_id: tournamentId,
          round_id: roundId,
          match_number: 1,
          challenge_id: null,
          player1_id: "user-1",
          player2_id: "user-3",
          winner_id: "user-1",
          status: "completed",
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          id: "match-2",
          tournament_id: tournamentId,
          round_id: roundId,
          match_number: 2,
          challenge_id: null,
          player1_id: "user-2",
          player2_id: "user-4",
          winner_id: "user-2",
          status: "completed",
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    const standings = await service.getStandings(tournamentId, "swiss");
    expect(standings[0]?.userId).toBe("user-1");
    expect(standings[1]?.userId).toBe("user-2");
    expect(standings[0]?.tiebreak).toBe(0.5);
    expect(standings[1]?.tiebreak).toBe(0);
  });

  it("summarizes rounds with byes and draws", async () => {
    const service = new TournamentService(db, {} as never, {} as never, {} as never);
    const tournamentId = "tournament-3";
    const roundId = "round-3";
    const nowIso = new Date().toISOString();

    await db
      .insertInto("tournaments")
      .values({
        id: tournamentId,
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "elimination",
        status: "active",
        length_minutes: 40,
        round_count: 3,
        current_round: 1,
        rating_ranges: "[]",
        tags: "",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_rounds")
      .values({
        id: roundId,
        tournament_id: tournamentId,
        round_number: 1,
        status: "active",
        problem_contest_id: 1000,
        problem_index: "B",
        problem_name: "Test 2",
        problem_rating: 1400,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_matches")
      .values([
        {
          id: "match-3",
          tournament_id: tournamentId,
          round_id: roundId,
          match_number: 1,
          challenge_id: null,
          player1_id: "user-1",
          player2_id: null,
          winner_id: "user-1",
          status: "bye",
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          id: "match-4",
          tournament_id: tournamentId,
          round_id: roundId,
          match_number: 2,
          challenge_id: null,
          player1_id: "user-2",
          player2_id: "user-3",
          winner_id: null,
          status: "completed",
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    const summaries = await service.listRoundSummaries(tournamentId, 1);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.matchCount).toBe(2);
    expect(summaries[0]?.completedCount).toBe(2);
    expect(summaries[0]?.byeCount).toBe(1);

    const matches = await service.listRoundMatches(tournamentId, 1);
    expect(matches).toHaveLength(2);
    expect(matches[1]?.isDraw).toBe(true);
  });

  it("returns completed tournament history with winners and participant counts", async () => {
    const service = new TournamentService(db, {} as never, {} as never, {} as never);
    const nowIso = new Date("2026-01-24T10:00:00.000Z").toISOString();
    const laterIso = new Date("2026-01-24T12:00:00.000Z").toISOString();

    await db
      .insertInto("tournaments")
      .values([
        {
          id: "tournament-1",
          guild_id: "guild-1",
          channel_id: "channel-1",
          host_user_id: "host-1",
          format: "swiss",
          status: "completed",
          length_minutes: 40,
          round_count: 3,
          current_round: 3,
          rating_ranges: "[]",
          tags: "",
          created_at: nowIso,
          updated_at: laterIso,
        },
        {
          id: "tournament-2",
          guild_id: "guild-1",
          channel_id: "channel-1",
          host_user_id: "host-2",
          format: "elimination",
          status: "cancelled",
          length_minutes: 60,
          round_count: 2,
          current_round: 1,
          rating_ranges: "[]",
          tags: "",
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    await db
      .insertInto("tournament_participants")
      .values([
        {
          tournament_id: "tournament-1",
          user_id: "user-1",
          seed: 1,
          score: 3,
          wins: 3,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          tournament_id: "tournament-1",
          user_id: "user-2",
          seed: 2,
          score: 1,
          wins: 1,
          losses: 2,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          tournament_id: "tournament-2",
          user_id: "user-3",
          seed: 1,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    const history = await service.getHistoryPage("guild-1", 1, 5);

    expect(history.total).toBe(2);
    expect(history.entries[0]?.id).toBe("tournament-1");
    expect(history.entries[0]?.participantCount).toBe(2);
    expect(history.entries[0]?.winnerId).toBe("user-1");
    expect(history.entries[1]?.id).toBe("tournament-2");
    expect(history.entries[1]?.winnerId).toBeNull();
  });

  it("returns tournament history detail with standings and rounds", async () => {
    const service = new TournamentService(db, {} as never, {} as never, {} as never);
    const tournamentId = "tournament-history-1";
    const roundId = "round-history-1";
    const nowIso = new Date().toISOString();

    await db
      .insertInto("tournaments")
      .values({
        id: tournamentId,
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "swiss",
        status: "completed",
        length_minutes: 40,
        round_count: 2,
        current_round: 2,
        rating_ranges: JSON.stringify([{ min: 800, max: 1200 }]),
        tags: "dp,greedy",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_participants")
      .values([
        {
          tournament_id: tournamentId,
          user_id: "user-1",
          seed: 1,
          score: 1,
          wins: 1,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-2",
          seed: 2,
          score: 0,
          wins: 0,
          losses: 1,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    await db
      .insertInto("tournament_rounds")
      .values({
        id: roundId,
        tournament_id: tournamentId,
        round_number: 1,
        status: "completed",
        problem_contest_id: 1000,
        problem_index: "A",
        problem_name: "History Problem",
        problem_rating: 1200,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_matches")
      .values({
        id: "match-history-1",
        tournament_id: tournamentId,
        round_id: roundId,
        match_number: 1,
        challenge_id: "challenge-history-1",
        player1_id: "user-1",
        player2_id: "user-2",
        winner_id: "user-1",
        status: "completed",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    const detail = await service.getHistoryDetail("guild-1", tournamentId, 2, 2);

    expect(detail).not.toBeNull();
    expect(detail?.entry.participantCount).toBe(2);
    expect(detail?.entry.winnerId).toBe("user-1");
    expect(detail?.channelId).toBe("channel-1");
    expect(detail?.hostUserId).toBe("host-1");
    expect(detail?.standings.length).toBeGreaterThan(0);
    expect(detail?.rounds.length).toBeGreaterThan(0);
  });

  it("builds a recap with rounds, matches, and handles", async () => {
    const service = new TournamentService(db, {} as never, {} as never, {} as never);
    const tournamentId = "tournament-3";
    const roundId = "round-3";
    const nowIso = new Date().toISOString();

    await db
      .insertInto("tournaments")
      .values({
        id: tournamentId,
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "swiss",
        status: "completed",
        length_minutes: 40,
        round_count: 1,
        current_round: 1,
        rating_ranges: "[]",
        tags: "dp",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("users")
      .values([
        {
          server_id: "guild-1",
          user_id: "user-1",
          handle: "tourist",
          rating: 2500,
          history: "[]",
          rating_history: "[]",
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          server_id: "guild-1",
          user_id: "user-2",
          handle: "petr",
          rating: 2600,
          history: "[]",
          rating_history: "[]",
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    await db
      .insertInto("tournament_participants")
      .values([
        {
          tournament_id: tournamentId,
          user_id: "user-1",
          seed: 1,
          score: 1,
          wins: 1,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-2",
          seed: 2,
          score: 0,
          wins: 0,
          losses: 1,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    await db
      .insertInto("tournament_rounds")
      .values({
        id: roundId,
        tournament_id: tournamentId,
        round_number: 1,
        status: "completed",
        problem_contest_id: 1000,
        problem_index: "A",
        problem_name: "Test",
        problem_rating: 1200,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_matches")
      .values({
        id: "match-3",
        tournament_id: tournamentId,
        round_id: roundId,
        match_number: 1,
        challenge_id: null,
        player1_id: "user-1",
        player2_id: "user-2",
        winner_id: "user-1",
        status: "completed",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    const recap = await service.getRecap("guild-1", tournamentId);

    expect(recap).not.toBeNull();
    expect(recap?.entry.participantCount).toBe(2);
    expect(recap?.participantHandles["user-1"]).toBe("tourist");
    expect(recap?.rounds[0]?.matches[0]?.winnerId).toBe("user-1");
  });

  it("computes arena standings using solve counts and time tiebreaks", async () => {
    const nowIso = new Date().toISOString();
    const tournamentId = "arena-standings";
    await db
      .insertInto("tournaments")
      .values({
        id: tournamentId,
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "arena",
        status: "active",
        length_minutes: 60,
        round_count: 3,
        current_round: 1,
        rating_ranges: "[]",
        tags: "",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_participants")
      .values([
        {
          tournament_id: tournamentId,
          user_id: "user-1",
          seed: 1,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-2",
          seed: 2,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    await db
      .insertInto("tournament_arena_state")
      .values({
        tournament_id: tournamentId,
        starts_at: 1000,
        ends_at: 2000,
        problem_count: 3,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_arena_solves")
      .values([
        {
          tournament_id: tournamentId,
          user_id: "user-1",
          problem_contest_id: 1000,
          problem_index: "A",
          submission_id: 10,
          solved_at: 1100,
          created_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-1",
          problem_contest_id: 1001,
          problem_index: "B",
          submission_id: 11,
          solved_at: 1200,
          created_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-2",
          problem_contest_id: 1000,
          problem_index: "A",
          submission_id: 12,
          solved_at: 1300,
          created_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          user_id: "user-2",
          problem_contest_id: 1001,
          problem_index: "B",
          submission_id: 13,
          solved_at: 1400,
          created_at: nowIso,
        },
      ])
      .execute();

    const cfClient = { request: jest.fn() } as unknown as CodeforcesClient;
    const store = new StoreService(db, cfClient);
    const problems = new ProblemService(cfClient, new NoopCodeforcesCache());
    const service = new TournamentService(db, problems, store, {} as ChallengeService);

    const standings = await service.getStandings(tournamentId, "arena");
    expect(standings[0]?.userId).toBe("user-1");
    expect(standings[0]?.score).toBe(2);
    expect(standings[1]?.userId).toBe("user-2");
  });

  it("records arena solves and updates participant scores", async () => {
    const nowIso = new Date().toISOString();
    const now = Math.floor(Date.now() / 1000);
    const tournamentId = "arena-sync";

    await db
      .insertInto("tournaments")
      .values({
        id: tournamentId,
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "arena",
        status: "active",
        length_minutes: 60,
        round_count: 2,
        current_round: 1,
        rating_ranges: "[]",
        tags: "",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_participants")
      .values([
        {
          tournament_id: tournamentId,
          user_id: "user-1",
          seed: 1,
          score: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          eliminated: 0,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .execute();

    await db
      .insertInto("users")
      .values({
        server_id: "guild-1",
        user_id: "user-1",
        handle: "tourist",
        rating: 3000,
        history: "[]",
        rating_history: "[]",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_arena_state")
      .values({
        tournament_id: tournamentId,
        starts_at: now - 100,
        ends_at: now + 1000,
        problem_count: 2,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .execute();

    await db
      .insertInto("tournament_arena_problems")
      .values([
        {
          tournament_id: tournamentId,
          problem_contest_id: 1000,
          problem_index: "A",
          problem_name: "Alpha",
          problem_rating: 1200,
          problem_tags: "[]",
          created_at: nowIso,
        },
        {
          tournament_id: tournamentId,
          problem_contest_id: 1001,
          problem_index: "B",
          problem_name: "Beta",
          problem_rating: 1400,
          problem_tags: "[]",
          created_at: nowIso,
        },
      ])
      .execute();

    const cfClient = {
      request: jest.fn().mockImplementation((_endpoint: string, params: { handle: string }) => {
        if (params.handle === "tourist") {
          return [
            {
              id: 101,
              contestId: 1000,
              problem: { contestId: 1000, index: "A", name: "Alpha" },
              verdict: "OK",
              creationTimeSeconds: now - 10,
              programmingLanguage: "GNU C++20",
            },
            {
              id: 102,
              contestId: 1002,
              problem: { contestId: 1002, index: "C", name: "Skip" },
              verdict: "OK",
              creationTimeSeconds: now - 10,
              programmingLanguage: "GNU C++20",
            },
          ];
        }
        return [];
      }),
    } as unknown as CodeforcesClient;

    const store = new StoreService(db, cfClient);
    const problems = new ProblemService(cfClient, new NoopCodeforcesCache());
    const service = new TournamentService(db, problems, store, {} as ChallengeService);

    await service.runArenaTick();

    const solves = await db
      .selectFrom("tournament_arena_solves")
      .select(["user_id", "problem_contest_id"])
      .where("tournament_id", "=", tournamentId)
      .execute();
    expect(solves).toHaveLength(1);

    const participant = await db
      .selectFrom("tournament_participants")
      .select(["score"])
      .where("tournament_id", "=", tournamentId)
      .where("user_id", "=", "user-1")
      .executeTakeFirst();
    expect(participant?.score).toBe(1);
  });
});
