import type { Guild, User } from "discord.js";

import { filterEntriesByGuildMembers } from "./guildMembers.js";
import { normalizeHandleKey } from "./handles.js";

export type TargetHandle = {
  handle: string;
  label: string;
};

type ContestTargetStore = {
  getHandle: (guildId: string, userId: string) => Promise<string | null>;
  resolveHandle: (
    handle: string
  ) => Promise<{ exists: boolean; canonicalHandle: string | null }>;
  getLinkedUsers: (guildId: string) => Promise<Array<{ userId: string; handle: string }>>;
};

type ResolveTargetsParams = {
  guild: Guild | null;
  guildId: string | null;
  user: User;
  commandName: string;
  userOptions: User[];
  handleInputs: string[];
  correlationId: string;
  store: ContestTargetStore;
  maxLinkedHandles?: number;
};

type ContestTargetsInteraction = {
  editReply: (message: string) => Promise<unknown>;
};

type TargetResolution =
  | { status: "ok"; targets: TargetHandle[] }
  | { status: "error"; message: string };

const errorResult = (message: string): TargetResolution => ({ status: "error", message });

export function getUserOptions(users: Array<User | null | undefined>): User[] {
  return users.filter((user): user is User => Boolean(user));
}

export function getContestTargetContextError(options: {
  guild: Guild | null;
  userOptions: User[];
  handleInputs: string[];
}): string | null {
  if (!options.guild && options.userOptions.length > 0) {
    return "Specify handles directly when using this command outside a server.";
  }
  if (!options.guild && options.handleInputs.length === 0) {
    return "Provide at least one handle or run this command in a server.";
  }
  return null;
}

function dedupeUsersById(users: User[]): User[] {
  const seen = new Set<string>();
  const result: User[] = [];
  for (const user of users) {
    if (seen.has(user.id)) {
      continue;
    }
    seen.add(user.id);
    result.push(user);
  }
  return result;
}

function addTargetHandle(existing: Map<string, TargetHandle>, handle: string, label: string) {
  const key = normalizeHandleKey(handle);
  if (!key || existing.has(key)) {
    return;
  }
  existing.set(key, { handle, label });
}

export async function resolveContestTargets(params: ResolveTargetsParams): Promise<TargetResolution> {
  const {
    guild,
    guildId,
    user,
    commandName,
    userOptions,
    handleInputs,
    correlationId,
    store,
    maxLinkedHandles,
  } = params;
  const uniqueUserOptions = dedupeUsersById(userOptions);
  const targets = new Map<string, TargetHandle>();
  const resolvedGuildId = guildId ?? guild?.id ?? "";

  const hasGuildContext = Boolean(guildId || guild);
  if (uniqueUserOptions.length > 0) {
    if (!hasGuildContext) {
      return errorResult("Specify handles directly when using this command outside a server.");
    }
    for (const option of uniqueUserOptions) {
      const handle = await store.getHandle(resolvedGuildId, option.id);
      if (!handle) {
        return errorResult(`User <@${option.id}> does not have a linked handle.`);
      }
      addTargetHandle(targets, handle, `<@${option.id}>`);
    }
  }

  for (const handleInput of handleInputs) {
    const resolved = await store.resolveHandle(handleInput);
    if (!resolved.exists) {
      return errorResult(`Invalid handle: ${handleInput}`);
    }
    const handle = resolved.canonicalHandle ?? handleInput;
    addTargetHandle(targets, handle, handle);
  }

  if (uniqueUserOptions.length === 0 && handleInputs.length === 0) {
    if (!hasGuildContext) {
      return errorResult("Provide at least one handle or run this command in a server.");
    }
    const linkedUsers = await store.getLinkedUsers(resolvedGuildId);
    const filteredLinkedUsers = guild
      ? await filterEntriesByGuildMembers(guild, linkedUsers, {
          correlationId,
          command: commandName,
          guildId: resolvedGuildId,
          userId: user.id,
        })
      : linkedUsers;
    if (filteredLinkedUsers.length === 0) {
      return errorResult("No linked handles found in this server yet.");
    }
    if (maxLinkedHandles && filteredLinkedUsers.length > maxLinkedHandles) {
      return errorResult(
        `Too many linked handles (${filteredLinkedUsers.length}). Provide specific handles or users.`
      );
    }
    for (const linked of filteredLinkedUsers) {
      addTargetHandle(targets, linked.handle, `<@${linked.userId}>`);
    }
  }

  const targetList = Array.from(targets.values());
  if (targetList.length === 0) {
    return errorResult("No handles found to check.");
  }

  return { status: "ok", targets: targetList };
}

export async function resolveContestTargetsOrReply(
  params: ResolveTargetsParams & { interaction: ContestTargetsInteraction }
): Promise<{ status: "ok"; targets: TargetHandle[] } | { status: "replied" }> {
  const { interaction, ...options } = params;
  const result = await resolveContestTargets(options);
  if (result.status === "error") {
    await interaction.editReply(result.message);
    return { status: "replied" };
  }
  return result;
}
