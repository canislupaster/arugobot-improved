import {
  buildEliminationPairings,
  buildSwissPairings,
  resolveMatchOutcome,
} from "../../src/utils/tournament.js";

describe("tournament utils", () => {
  it("pairs swiss players without repeating opponents when possible", () => {
    const participants = [
      { userId: "a", score: 2, seed: 1 },
      { userId: "b", score: 2, seed: 2 },
      { userId: "c", score: 1, seed: 3 },
      { userId: "d", score: 1, seed: 4 },
    ];
    const history = new Map<string, Set<string>>([["a", new Set(["b"])]]);

    const pairings = buildSwissPairings(participants, history);

    expect(pairings).toEqual([
      { player1Id: "a", player2Id: "c" },
      { player1Id: "b", player2Id: "d" },
    ]);
  });

  it("adds a bye in elimination when participants are odd", () => {
    const participants = [
      { userId: "a", score: 0, seed: 1 },
      { userId: "b", score: 0, seed: 2 },
      { userId: "c", score: 0, seed: 3 },
    ];

    const pairings = buildEliminationPairings(participants);

    expect(pairings).toEqual([
      { player1Id: "a", player2Id: "b" },
      { player1Id: "c", player2Id: null },
    ]);
  });

  it("resolves match outcomes with solve times and seed tiebreaks", () => {
    const seeds = new Map([
      ["a", 2],
      ["b", 1],
    ]);

    const solved = resolveMatchOutcome(
      [
        { userId: "a", solvedAt: 100 },
        { userId: "b", solvedAt: 120 },
      ],
      seeds,
      true
    );
    expect(solved).toEqual({ winnerId: "a", loserId: "b", isDraw: false });

    const draw = resolveMatchOutcome(
      [
        { userId: "a", solvedAt: null },
        { userId: "b", solvedAt: null },
      ],
      seeds,
      true
    );
    expect(draw).toEqual({ winnerId: null, loserId: null, isDraw: true });

    const seedWin = resolveMatchOutcome(
      [
        { userId: "a", solvedAt: null },
        { userId: "b", solvedAt: null },
      ],
      seeds,
      false
    );
    expect(seedWin).toEqual({ winnerId: "b", loserId: "a", isDraw: false });
  });
});
