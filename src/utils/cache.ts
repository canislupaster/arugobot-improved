export function isCacheFresh(lastFetched: string | null | undefined, ttlMs: number): boolean {
  if (!lastFetched || ttlMs <= 0) {
    return false;
  }
  const timestamp = Date.parse(lastFetched);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const ageMs = Date.now() - timestamp;
  return ageMs >= 0 && ageMs <= ttlMs;
}
