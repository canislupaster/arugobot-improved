import type { ChatInputCommandInteraction, Guild, User } from "discord.js";

import { normalizeHandleInput, normalizeHandleKey } from "./handles.js";
import { resolveGuildRoster } from "./roster.js";

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
const formatTooManyHandlesMessage = (count: number) =>
  `Too many linked handles (${count}). Provide specific handles or users.`;
const getMaxLinkedHandlesError = (
  count: number,
  maxLinkedHandles?: number
): TargetResolution | null => {
  if (maxLinkedHandles && count > maxLinkedHandles) {
    return errorResult(formatTooManyHandlesMessage(count));
  }
  return null;
};

export function getUserOptions(users: Array<User | null | undefined>): User[] {
  return users.filter((user): user is User => Boolean(user));
}

export function getContestUserOptions(interaction: ChatInputCommandInteraction): User[] {
  return getUserOptions([
    interaction.options.getUser("user1"),
    interaction.options.getUser("user2"),
    interaction.options.getUser("user3"),
    interaction.options.getUser("user4"),
  ]);
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

type ContestTargetContextInteraction = {
  reply: (options: { content: string }) => Promise<unknown>;
};

export async function validateContestTargetContextOrReply(
  interaction: ContestTargetContextInteraction,
  options: {
    guild: Guild | null;
    guildId?: string | null;
    userOptions: User[];
    handleInputs: string[];
  }
): Promise<{ status: "ok" } | { status: "replied" }> {
  const error = getContestTargetContextError(options);
  if (!error) {
    return { status: "ok" };
  }
  await interaction.reply({ content: error });
  return { status: "replied" };
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

type LinkedUserHandle = { userId: string; handle: string };

function addLinkedUsers(
  targets: Map<string, TargetHandle>,
  linkedUsers: LinkedUserHandle[]
): void {
  for (const linked of linkedUsers) {
    addTargetHandle(targets, linked.handle, `<@${linked.userId}>`);
  }
}

function finalizeTargets(targets: Map<string, TargetHandle>): TargetResolution {
  const targetList = Array.from(targets.values());
  if (targetList.length === 0) {
    return errorResult("No handles found to check.");
  }
  return { status: "ok", targets: targetList };
}

type NormalizedHandleInput = {
  raw: string;
  normalized: string;
};

function normalizeHandleInputs(inputs: string[]): NormalizedHandleInput[] {
  const seen = new Set<string>();
  const result: NormalizedHandleInput[] = [];
  for (const raw of inputs) {
    const normalized = normalizeHandleInput(raw);
    if (!normalized) {
      continue;
    }
    const key = normalizeHandleKey(normalized);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ raw, normalized });
  }
  return result;
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
  const normalizedHandleInputs = normalizeHandleInputs(handleInputs);

  const contextError = getContestTargetContextError({
    guild,
    guildId,
    userOptions: uniqueUserOptions,
    handleInputs: normalizedHandleInputs.map((entry) => entry.normalized),
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

  if (normalizedHandleInputs.length > 0) {
    for (const handleInput of normalizedHandleInputs) {
      const resolved = await store.resolveHandle(handleInput.normalized);
      if (!resolved.exists) {
        return errorResult(`Invalid handle: ${handleInput.raw}`);
      }
      const handle = resolved.canonicalHandle ?? handleInput.normalized;
      addTargetHandle(targets, handle, handle);
    }
  }

  if (uniqueUserOptions.length === 0 && normalizedHandleInputs.length === 0) {
    const linkedUsers = await store.getLinkedUsers(resolvedGuildId);
    if (!guild) {
      if (linkedUsers.length === 0) {
        return errorResult(NO_LINKED_HANDLES_MESSAGE);
      }
      const maxError = getMaxLinkedHandlesError(linkedUsers.length, maxLinkedHandles);
      if (maxError) {
        return maxError;
      }
      addLinkedUsers(targets, linkedUsers);
      return finalizeTargets(targets);
    }

    const rosterResult = await resolveGuildRoster(
      guild,
      linkedUsers,
      {
        correlationId,
        command: commandName,
        guildId: resolvedGuildId,
        userId: user.id,
      },
      { noMembers: NO_CURRENT_MEMBERS_MESSAGE, noHandles: NO_LINKED_HANDLES_MESSAGE }
    );
    if (rosterResult.status === "empty") {
      return errorResult(rosterResult.message);
    }
    const maxError = getMaxLinkedHandlesError(rosterResult.roster.length, maxLinkedHandles);
    if (maxError) {
      return maxError;
    }
    addLinkedUsers(targets, rosterResult.roster);
  }

  return finalizeTargets(targets);
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
