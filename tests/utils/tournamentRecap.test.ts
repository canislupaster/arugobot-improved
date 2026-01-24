import type { TournamentRecap } from "../../src/services/tournaments.js";
import {
  formatTournamentRecapCsv,
  formatTournamentRecapMarkdown,
} from "../../src/utils/tournamentRecap.js";

describe("tournament recap formatting", () => {
  const recap: TournamentRecap = {
    entry: {
      id: "tournament-1",
      format: "swiss",
      status: "completed",
      lengthMinutes: 40,
      roundCount: 1,
      ratingRanges: [{ min: 800, max: 1200 }],
      tags: "dp",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T01:00:00.000Z",
      participantCount: 2,
      winnerId: "user-1",
    },
    channelId: "channel-1",
    hostUserId: "host-1",
    participantHandles: {
      "user-1": "tourist",
      "user-2": "petr",
    },
    standings: [
      {
        userId: "user-1",
        seed: 1,
        score: 1,
        wins: 1,
        losses: 0,
        draws: 0,
        eliminated: false,
        tiebreak: 1,
        matchesPlayed: 1,
      },
      {
        userId: "user-2",
        seed: 2,
        score: 0,
        wins: 0,
        losses: 1,
        draws: 0,
        eliminated: false,
        tiebreak: 0,
        matchesPlayed: 1,
      },
    ],
    rounds: [
      {
        roundNumber: 1,
        status: "completed",
        problem: {
          contestId: 1000,
          index: "A",
          name: "Test",
          rating: 1200,
          tags: [],
        },
        matches: [
          {
            matchNumber: 1,
            player1Id: "user-1",
            player2Id: "user-2",
            winnerId: "user-1",
            status: "completed",
            isDraw: false,
          },
        ],
      },
    ],
  };

  it("formats a markdown recap with standings and rounds", () => {
    const markdown = formatTournamentRecapMarkdown(recap);
    expect(markdown).toContain("# Tournament recap");
    expect(markdown).toContain("Standings");
    expect(markdown).toContain("Round 1");
    expect(markdown).toContain("Match 1");
  });

  it("formats a csv recap with headers and match rows", () => {
    const csv = formatTournamentRecapCsv(recap);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("section,round,match");
    expect(csv).toContain("match,1,1");
    expect(csv).toContain("standings");
  });
});
