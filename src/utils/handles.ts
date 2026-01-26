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
    return trimmed;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function normalizeHandleKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseHandleList(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
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
