import type { Contest } from "../services/contests.js";

export function buildContestUrl(contest: Pick<Contest, "id" | "isGym">): string {
  const base = contest.isGym ? "https://codeforces.com/gym" : "https://codeforces.com/contest";
  return `${base}/${contest.id}`;
}
