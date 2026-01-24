import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
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
});
