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
const NO_LINKED_HANDLES_MESSAGE =
  "No linked handles yet. Use /register to link a Codeforces handle.";
const NO_CURRENT_MEMBERS_MESSAGE =
  "No linked handles found for current server members. Use /handles to review linked accounts.";

export function getUserOptions(users: Array<User | null | undefined>): User[] {
  return users.filter((user): user is User => Boolean(user));
}

export function getContestTargetContextError(options: {
  guild: Guild | null;
  guildId?: string | null;
  userOptions: User[];
  handleInputs: string[];
}): string | null {
  const hasGuildContext = Boolean(options.guild || options.guildId);
  if (!hasGuildContext && options.userOptions.length > 0) {
    return "Specify handles directly when using this command outside a server.";
  }
  if (!hasGuildContext && options.handleInputs.length === 0) {
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

  const contextError = getContestTargetContextError({
    guild,
    guildId,
    userOptions: uniqueUserOptions,
    handleInputs,
  });
  if (contextError) {
    return errorResult(contextError);
  }
  if (uniqueUserOptions.length > 0) {
    const resolvedUsers = await Promise.all(
      uniqueUserOptions.map(async (option) => ({
        option,
        handle: await store.getHandle(resolvedGuildId, option.id),
      }))
    );
    for (const entry of resolvedUsers) {
      if (!entry.handle) {
        return errorResult(`User <@${entry.option.id}> does not have a linked handle.`);
      }
      addTargetHandle(targets, entry.handle, `<@${entry.option.id}>`);
    }
  }

  if (handleInputs.length > 0) {
    const resolvedInputs = await Promise.all(
      handleInputs.map(async (handleInput) => ({
        handleInput,
        resolved: await store.resolveHandle(handleInput),
      }))
    );
    for (const entry of resolvedInputs) {
      if (!entry.resolved.exists) {
        return errorResult(`Invalid handle: ${entry.handleInput}`);
      }
      const handle = entry.resolved.canonicalHandle ?? entry.handleInput;
      addTargetHandle(targets, handle, handle);
    }
  }

  if (uniqueUserOptions.length === 0 && handleInputs.length === 0) {
    const linkedUsers = await store.getLinkedUsers(resolvedGuildId);
    if (linkedUsers.length === 0) {
      return errorResult(NO_LINKED_HANDLES_MESSAGE);
    }
    const filteredLinkedUsers = guild
      ? await filterEntriesByGuildMembers(guild, linkedUsers, {
          correlationId,
          command: commandName,
          guildId: resolvedGuildId,
          userId: user.id,
        })
      : linkedUsers;
    if (filteredLinkedUsers.length === 0) {
      return errorResult(NO_CURRENT_MEMBERS_MESSAGE);
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
