const PROFILE_PATTERN = /codeforces\.com\/(?:profile|u)\/([^/?#\s]+)/i;

export type HandleTargetResolution =
  | { handle: string; linkedUserId: string | null }
  | { error: string };

type HandleTargetStore = {
  resolveHandle: (
    handle: string
  ) => Promise<{ exists: boolean; canonicalHandle?: string | null }>;
  getHandle: (guildId: string, userId: string) => Promise<string | null>;
  getUserIdByHandle?: (guildId: string, handle: string) => Promise<string | null>;
};

type HandleTargetOptions = {
  guildId: string;
  targetId: string;
  handleInput: string;
  includeLinkedUserId?: boolean;
};

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
    return unwrapped.startsWith("@") ? unwrapped.slice(1).trim() : unwrapped;
  }
  try {
    const decoded = decodeURIComponent(match[1]);
    return decoded.startsWith("@") ? decoded.slice(1).trim() : decoded;
  } catch {
    return match[1].startsWith("@") ? match[1].slice(1).trim() : match[1];
  }
}

export function normalizeHandleKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export function dedupeHandles(handles: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const handle of handles) {
    const trimmed = handle.trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizeHandleKey(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function parseHandleList(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/[\s,]+/u)
    .map((value) => normalizeHandleInput(value))
    .filter(Boolean);
}

export function normalizeHandleFilter(handles: string[]): string[] {
  const normalized = handles
    .map((handle) => normalizeHandleKey(normalizeHandleInput(handle)))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

export function parseHandleFilterInput(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  return normalizeHandleFilter(parseHandleList(raw));
}

export async function resolveHandleTarget(
  store: HandleTargetStore,
  options: HandleTargetOptions
): Promise<HandleTargetResolution> {
  const { guildId, targetId, handleInput, includeLinkedUserId = false } = options;
  if (handleInput) {
    const handleInfo = await store.resolveHandle(handleInput);
    if (!handleInfo.exists) {
      return { error: "Invalid handle." };
    }
    const handle = handleInfo.canonicalHandle ?? handleInput;
    if (includeLinkedUserId && store.getUserIdByHandle) {
      const linkedUserId = await store.getUserIdByHandle(guildId, handle);
      return { handle, linkedUserId };
    }
    return { handle, linkedUserId: null };
  }

  const linkedHandle = await store.getHandle(guildId, targetId);
  if (!linkedHandle) {
    return { error: "Handle not linked." };
  }
  return { handle: linkedHandle, linkedUserId: targetId };
}

type HandleTargetContextOptions = {
  guildId?: string | null;
  targetId: string;
  handleInput: string;
  includeLinkedUserId?: boolean;
};

export async function resolveHandleTargetWithOptionalGuild(
  store: HandleTargetStore,
  options: HandleTargetContextOptions
): Promise<HandleTargetResolution> {
  const { guildId, targetId, handleInput, includeLinkedUserId = false } = options;
  if (!guildId) {
    if (!handleInput) {
      return { error: "Provide a handle when using this command in DMs." };
    }
    const handleInfo = await store.resolveHandle(handleInput);
    if (!handleInfo.exists) {
      return { error: "Invalid handle." };
    }
    return { handle: handleInfo.canonicalHandle ?? handleInput, linkedUserId: null };
  }
  return resolveHandleTarget(store, { guildId, targetId, handleInput, includeLinkedUserId });
}
