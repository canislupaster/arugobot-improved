const PROFILE_PATTERN = /codeforces\.com\/(?:profile|u)\/([^/?#\s]+)/i;

export function normalizeHandleInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">")
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const match = unwrapped.match(PROFILE_PATTERN);
  if (!match) {
    return trimmed;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
