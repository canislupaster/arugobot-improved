export type TournamentPairingParticipant = {
  userId: string;
  score: number;
  seed: number;
};

export type TournamentPairing = {
  player1Id: string;
  player2Id: string | null;
};

export type PairingHistory = Map<string, Set<string>>;

export type MatchParticipantResult = {
  userId: string;
  solvedAt: number | null;
};

export type MatchOutcome = {
  winnerId: string | null;
  loserId: string | null;
  isDraw: boolean;
};

export function buildSwissPairings(
  participants: TournamentPairingParticipant[],
  history: PairingHistory
): TournamentPairing[] {
  const sorted = [...participants].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.seed - b.seed;
  });

  const unpaired = new Set(sorted.map((participant) => participant.userId));
  const pairs: TournamentPairing[] = [];

  for (const participant of sorted) {
    if (!unpaired.has(participant.userId)) {
      continue;
    }
    unpaired.delete(participant.userId);

    const opponents = history.get(participant.userId) ?? new Set<string>();
    let opponentId: string | null = null;

    for (const candidate of sorted) {
      if (!unpaired.has(candidate.userId)) {
        continue;
      }
      if (opponents.has(candidate.userId)) {
        continue;
      }
      opponentId = candidate.userId;
      break;
    }

    if (!opponentId) {
      for (const candidate of sorted) {
        if (!unpaired.has(candidate.userId)) {
          continue;
        }
        opponentId = candidate.userId;
        break;
      }
    }

    if (opponentId) {
      unpaired.delete(opponentId);
      pairs.push({ player1Id: participant.userId, player2Id: opponentId });
    } else {
      pairs.push({ player1Id: participant.userId, player2Id: null });
    }
  }

  return pairs;
}

export function buildEliminationPairings(
  participants: TournamentPairingParticipant[]
): TournamentPairing[] {
  const sorted = [...participants].sort((a, b) => a.seed - b.seed);
  const pairs: TournamentPairing[] = [];

  for (let i = 0; i < sorted.length; i += 2) {
    const player1 = sorted[i];
    const player2 = sorted[i + 1] ?? null;
    if (!player1) {
      continue;
    }
    pairs.push({
      player1Id: player1.userId,
      player2Id: player2?.userId ?? null,
    });
  }

  return pairs;
}

export function resolveMatchOutcome(
  participants: MatchParticipantResult[],
  seeds: Map<string, number>,
  allowDraws: boolean
): MatchOutcome {
  if (participants.length < 2) {
    const winnerId = participants[0]?.userId ?? null;
    return { winnerId, loserId: null, isDraw: false };
  }

  const [a, b] = participants;
  if (a.solvedAt !== null && b.solvedAt !== null) {
    if (a.solvedAt !== b.solvedAt) {
      return a.solvedAt < b.solvedAt
        ? { winnerId: a.userId, loserId: b.userId, isDraw: false }
        : { winnerId: b.userId, loserId: a.userId, isDraw: false };
    }
    if (allowDraws) {
      return { winnerId: null, loserId: null, isDraw: true };
    }
  } else if (a.solvedAt !== null || b.solvedAt !== null) {
    return a.solvedAt !== null
      ? { winnerId: a.userId, loserId: b.userId, isDraw: false }
      : { winnerId: b.userId, loserId: a.userId, isDraw: false };
  }

  if (allowDraws) {
    return { winnerId: null, loserId: null, isDraw: true };
  }

  const aSeed = seeds.get(a.userId) ?? Number.MAX_SAFE_INTEGER;
  const bSeed = seeds.get(b.userId) ?? Number.MAX_SAFE_INTEGER;
  if (aSeed !== bSeed) {
    return aSeed < bSeed
      ? { winnerId: a.userId, loserId: b.userId, isDraw: false }
      : { winnerId: b.userId, loserId: a.userId, isDraw: false };
  }

  return { winnerId: a.userId, loserId: b.userId, isDraw: false };
}
