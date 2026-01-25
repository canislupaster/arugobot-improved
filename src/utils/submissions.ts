import { formatDiscordRelativeTime } from "./time.js";

export type SubmissionSummary = {
  contestId: number | null;
  index: string;
  name: string;
  verdict: string | null;
  creationTimeSeconds: number;
};

export type SubmissionResultFilter = "all" | "accepted" | "rejected";

export function filterSubmissionsByResult(
  submissions: SubmissionSummary[],
  filter: SubmissionResultFilter
): SubmissionSummary[] {
  if (filter === "accepted") {
    return submissions.filter((submission) => submission.verdict === "OK");
  }
  if (filter === "rejected") {
    return submissions.filter((submission) => submission.verdict !== "OK");
  }
  return submissions;
}

export function formatSubmissionLine(submission: SubmissionSummary): string {
  const verdict = submission.verdict ?? "UNKNOWN";
  const when = formatDiscordRelativeTime(submission.creationTimeSeconds);
  if (submission.contestId) {
    return `- [${submission.index}. ${submission.name}](https://codeforces.com/problemset/problem/${submission.contestId}/${submission.index}) • ${verdict} • ${when}`;
  }
  return `- ${submission.index}. ${submission.name} • ${verdict} • ${when}`;
}
