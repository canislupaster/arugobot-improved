import type { TournamentRecap, TournamentStandingsEntry } from "../services/tournaments.js";

import { formatTime } from "./rating.js";

function formatRatingRanges(ranges: Array<{ min: number; max: number }>): string {
  if (ranges.length === 0) {
    return "Any";
  }
  return ranges
    .map((range) => (range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`))
    .join(", ");
}

function formatTags(tags: string): string {
  const trimmed = tags.trim();
  return trimmed.length > 0 ? trimmed : "None";
}

function formatUserLabel(userId: string, handle?: string | null): string {
  if (handle) {
    return `<@${userId}> (${handle})`;
  }
  return `<@${userId}>`;
}

function formatStandingsLine(
  entry: TournamentStandingsEntry,
  handle: string | null,
  format: TournamentRecap["entry"]["format"]
): string {
  if (format === "arena") {
    const timeLabel = entry.score > 0 ? ` • ${formatTime(entry.tiebreak)}` : "";
    return `${formatUserLabel(entry.userId, handle)} • ${entry.score} solves${timeLabel}`;
  }
  const tiebreakLabel = format === "swiss" ? ` • TB ${entry.tiebreak.toFixed(1)}` : "";
  const statusLabel = entry.eliminated ? " • eliminated" : "";
  return `${formatUserLabel(entry.userId, handle)} • ${entry.score} pts (${entry.wins}-${entry.losses}-${entry.draws})${tiebreakLabel}${statusLabel}`;
}

function formatMatchLine(
  match: TournamentRecap["rounds"][number]["matches"][number],
  handles: Record<string, string | null>
): string {
  const player1 = formatUserLabel(match.player1Id, handles[match.player1Id] ?? null);
  if (!match.player2Id) {
    return `Match ${match.matchNumber}: ${player1} has a bye`;
  }
  const player2 = formatUserLabel(match.player2Id, handles[match.player2Id] ?? null);
  const winnerLabel = match.winnerId
    ? formatUserLabel(match.winnerId, handles[match.winnerId] ?? null)
    : match.isDraw
      ? "Draw"
      : "No winner";
  const statusLabel = match.status === "completed" ? "completed" : match.status;
  return `Match ${match.matchNumber}: ${player1} vs ${player2} • ${winnerLabel} • ${statusLabel}`;
}

function escapeCsv(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function formatTournamentRecapMarkdown(recap: TournamentRecap): string {
  const { entry, channelId, hostUserId, standings, rounds, participantHandles } = recap;
  const winnerLabel = entry.winnerId
    ? formatUserLabel(entry.winnerId, participantHandles[entry.winnerId] ?? null)
    : "None";

  const lines: string[] = [
    "# Tournament recap",
    `Status: ${entry.status === "completed" ? "Completed" : "Cancelled"}`,
    `Format: ${
      entry.format === "swiss" ? "Swiss" : entry.format === "elimination" ? "Elimination" : "Arena"
    }`,
    `Length: ${entry.lengthMinutes}m`,
    `Rounds: ${entry.roundCount}`,
    `Participants: ${entry.participantCount}`,
    `Winner: ${winnerLabel}`,
    `Updated: ${entry.updatedAt}`,
    `Channel: <#${channelId}>`,
    `Host: <@${hostUserId}>`,
    `Ranges: ${formatRatingRanges(entry.ratingRanges)}`,
    `Tags: ${formatTags(entry.tags)}`,
    "",
    "## Standings",
  ];

  if (standings.length === 0) {
    lines.push("No standings recorded.");
  } else {
    standings.forEach((participant, index) => {
      const handle = participantHandles[participant.userId] ?? null;
      lines.push(`${index + 1}. ${formatStandingsLine(participant, handle, entry.format)}`);
    });
  }

  if (entry.format === "arena" && recap.arenaProblems?.length) {
    lines.push("", "## Arena problems");
    recap.arenaProblems.forEach((problem) => {
      const problemId = `${problem.contestId}${problem.index}`;
      lines.push(`- ${problemId} - ${problem.name} (${problem.rating ?? "?"})`);
    });
  }

  for (const round of rounds) {
    const problemId = `${round.problem.contestId}${round.problem.index}`;
    const problemLine = `${problemId} - ${round.problem.name} (${round.problem.rating ?? "?"})`;
    lines.push("", `## Round ${round.roundNumber} (${round.status})`, `Problem: ${problemLine}`);
    if (round.matches.length === 0) {
      lines.push("No matches recorded.");
      continue;
    }
    round.matches.forEach((match) => {
      lines.push(`- ${formatMatchLine(match, participantHandles)}`);
    });
  }

  return lines.join("\n");
}

export function formatTournamentRecapCsv(recap: TournamentRecap): string {
  const { entry, standings, rounds, participantHandles } = recap;
  const header = [
    "section",
    "round",
    "match",
    "player1_id",
    "player1_handle",
    "player2_id",
    "player2_handle",
    "winner_id",
    "winner_handle",
    "status",
    "problem_id",
    "problem_name",
    "problem_rating",
    "score",
    "wins",
    "losses",
    "draws",
    "tiebreak",
    "seed",
    "eliminated",
  ];

  const rows: string[][] = [];
  rows.push(header);

  for (const participant of standings) {
    const handle = participantHandles[participant.userId] ?? "";
    rows.push(
      [
        "standings",
        "",
        "",
        participant.userId,
        handle,
        "",
        "",
        "",
        "",
        entry.status,
        "",
        "",
        "",
        participant.score,
        participant.wins,
        participant.losses,
        participant.draws,
        entry.format === "swiss" || entry.format === "arena" ? participant.tiebreak : "",
        participant.seed,
        participant.eliminated ? "1" : "0",
      ].map(escapeCsv)
    );
  }

  for (const round of rounds) {
    const problemId = `${round.problem.contestId}${round.problem.index}`;
    for (const match of round.matches) {
      rows.push(
        [
          "match",
          round.roundNumber,
          match.matchNumber,
          match.player1Id,
          participantHandles[match.player1Id] ?? "",
          match.player2Id ?? "",
          match.player2Id ? (participantHandles[match.player2Id] ?? "") : "",
          match.winnerId ?? "",
          match.winnerId ? (participantHandles[match.winnerId] ?? "") : "",
          match.isDraw ? "draw" : match.status,
          problemId,
          round.problem.name,
          round.problem.rating ?? "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ].map(escapeCsv)
      );
    }
  }

  return rows.map((row) => row.join(",")).join("\n");
}
