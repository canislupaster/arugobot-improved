export type ProblemReference = {
  contestId: number;
  index: string;
  id: string;
};

const CONTEST_URL_PATTERN = /codeforces\.com\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/i;
const PROBLEMSET_URL_PATTERN = /codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/i;
const ID_PATTERN = /^(\d+)([A-Za-z][A-Za-z0-9]*)$/;

export function parseProblemReference(raw: string): ProblemReference | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(CONTEST_URL_PATTERN) ?? trimmed.match(PROBLEMSET_URL_PATTERN);
  if (urlMatch) {
    const contestId = Number(urlMatch[1]);
    const index = urlMatch[2]!.toUpperCase();
    if (!Number.isFinite(contestId) || contestId <= 0) {
      return null;
    }
    return { contestId, index, id: `${contestId}${index}` };
  }

  const compact = trimmed.replace(/\s+/g, "");
  const idMatch = compact.match(ID_PATTERN);
  if (!idMatch) {
    return null;
  }

  const contestId = Number(idMatch[1]);
  const index = idMatch[2]!.toUpperCase();
  if (!Number.isFinite(contestId) || contestId <= 0) {
    return null;
  }

  return { contestId, index, id: `${contestId}${index}` };
}
