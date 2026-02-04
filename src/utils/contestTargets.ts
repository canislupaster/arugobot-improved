import { EmbedBuilder, type ChatInputCommandInteraction, type Guild, type User } from "discord.js";

import { normalizeHandleInput, normalizeHandleKey, parseHandleList } from "./handles.js";
import { resolveGuildRoster } from "./roster.js";

export type TargetHandle = {
  handle: string;
  label: string;
};

const MISSING_TARGET_PREVIEW_LIMIT = 10;

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

export async function resolveContestTargetInputsOrReply(
  interaction: ChatInputCommandInteraction,
  handlesRaw: string
): Promise<
  | { status: "ok"; handleInputs: string[]; userOptions: User[] }
  | { status: "replied" }
> {
  const handleInputs = parseHandleList(handlesRaw.trim());
  const userOptions = getContestUserOptions(interaction);
  const contextError = getContestTargetContextError({
    guild: interaction.guild,
    userOptions,
    handleInputs,
  });
  if (contextError) {
    await interaction.reply({ content: contextError });
    return { status: "replied" };
  }
  return { status: "ok", handleInputs, userOptions };
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

export function partitionTargetsByHandle<T>(
  targets: TargetHandle[],
  entryMap: Map<string, T>
): { found: Array<TargetHandle & T>; missing: TargetHandle[] } {
  const found: Array<TargetHandle & T> = [];
  const missing: TargetHandle[] = [];
  for (const target of targets) {
    const entry = entryMap.get(normalizeHandleKey(target.handle));
    if (!entry) {
      missing.push(target);
      continue;
    }
    found.push({ ...target, ...entry });
  }
  return { found, missing };
}

export function buildMissingTargetsField(
  missing: TargetHandle[]
): { name: string; value: string; inline: false } | null {
  if (missing.length === 0) {
    return null;
  }
  const preview = missing
    .slice(0, MISSING_TARGET_PREVIEW_LIMIT)
    .map((entry) => entry.label)
    .join(", ");
  const remaining = missing.length - MISSING_TARGET_PREVIEW_LIMIT;
  const suffix = remaining > 0 ? `\n...and ${remaining} more.` : "";
  return {
    name: "Not found",
    value: `${preview}${suffix}`,
    inline: false,
  };
}

export function applyMissingTargetsAndStaleFooter(options: {
  embed: EmbedBuilder;
  missing: TargetHandle[];
  footerNotes: string[];
  isStale: boolean;
}): void {
  const missingField = buildMissingTargetsField(options.missing);
  if (missingField) {
    options.embed.addFields(missingField);
  }
  if (options.isStale) {
    options.footerNotes.push("Showing cached data due to a temporary Codeforces error.");
  }
  if (options.footerNotes.length > 0) {
    options.embed.setFooter({ text: options.footerNotes.join(" ") });
  }
}

type LinkedUserHandle = { userId: string; handle: string };

function finalizeTargets(targets: Map<string, TargetHandle>): TargetResolution {
  const targetList = Array.from(targets.values());
  if (targetList.length === 0) {
    return errorResult("No handles found to check.");
  }
  return { status: "ok", targets: targetList };
}

function resolveTargetsFromLinkedUsers(
  linkedUsers: LinkedUserHandle[],
  maxLinkedHandles?: number
): TargetResolution {
  const maxError = getMaxLinkedHandlesError(linkedUsers.length, maxLinkedHandles);
  if (maxError) {
    return maxError;
  }
  const targets = new Map<string, TargetHandle>();
  for (const linked of linkedUsers) {
    addTargetHandle(targets, linked.handle, `<@${linked.userId}>`);
  }
  return finalizeTargets(targets);
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

async function addUserOptionTargets(
  targets: Map<string, TargetHandle>,
  store: ContestTargetStore,
  guildId: string,
  userOptions: User[]
): Promise<TargetResolution | null> {
  if (userOptions.length === 0) {
    return null;
  }
  const resolvedUsers = await Promise.all(
    userOptions.map(async (option) => ({
      option,
      handle: await store.getHandle(guildId, option.id),
    }))
  );
  for (const entry of resolvedUsers) {
    if (!entry.handle) {
      return errorResult(`User <@${entry.option.id}> does not have a linked handle.`);
    }
    addTargetHandle(targets, entry.handle, `<@${entry.option.id}>`);
  }
  return null;
}

async function addHandleInputTargets(
  targets: Map<string, TargetHandle>,
  store: ContestTargetStore,
  normalizedHandleInputs: NormalizedHandleInput[]
): Promise<TargetResolution | null> {
  if (normalizedHandleInputs.length === 0) {
    return null;
  }
  for (const handleInput of normalizedHandleInputs) {
    const resolved = await store.resolveHandle(handleInput.normalized);
    if (!resolved.exists) {
      return errorResult(`Invalid handle: ${handleInput.raw}`);
    }
    const handle = resolved.canonicalHandle ?? handleInput.normalized;
    addTargetHandle(targets, handle, handle);
  }
  return null;
}

async function resolveDirectTargets(params: {
  guildId: string;
  store: ContestTargetStore;
  userOptions: User[];
  normalizedHandleInputs: NormalizedHandleInput[];
}): Promise<TargetResolution> {
  const targets = new Map<string, TargetHandle>();
  const userOptionError = await addUserOptionTargets(
    targets,
    params.store,
    params.guildId,
    params.userOptions
  );
  if (userOptionError) {
    return userOptionError;
  }
  const handleError = await addHandleInputTargets(
    targets,
    params.store,
    params.normalizedHandleInputs
  );
  if (handleError) {
    return handleError;
  }
  return finalizeTargets(targets);
}

async function resolveFallbackTargets(params: {
  guild: Guild | null;
  guildId: string;
  store: ContestTargetStore;
  maxLinkedHandles?: number;
  commandName: string;
  correlationId: string;
  user: User;
}): Promise<TargetResolution> {
  const linkedUsers = await params.store.getLinkedUsers(params.guildId);
  if (!params.guild) {
    if (linkedUsers.length === 0) {
      return errorResult(NO_LINKED_HANDLES_MESSAGE);
    }
    return resolveTargetsFromLinkedUsers(linkedUsers, params.maxLinkedHandles);
  }

  const rosterResult = await resolveGuildRoster(
    params.guild,
    linkedUsers,
    {
      correlationId: params.correlationId,
      command: params.commandName,
      guildId: params.guildId,
      userId: params.user.id,
    },
    { noMembers: NO_CURRENT_MEMBERS_MESSAGE, noHandles: NO_LINKED_HANDLES_MESSAGE }
  );
  if (rosterResult.status === "empty") {
    return errorResult(rosterResult.message);
  }
  return resolveTargetsFromLinkedUsers(rosterResult.roster, params.maxLinkedHandles);
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

  const hasDirectTargets =
    uniqueUserOptions.length > 0 || normalizedHandleInputs.length > 0;
  const resolvedGuildId = guildId ?? guild?.id ?? "";

  if (hasDirectTargets) {
    return resolveDirectTargets({
      guildId: resolvedGuildId,
      store,
      userOptions: uniqueUserOptions,
      normalizedHandleInputs,
    });
  }

  return resolveFallbackTargets({
    guild,
    guildId: resolvedGuildId,
    store,
    maxLinkedHandles,
    commandName,
    correlationId,
    user,
  });
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

export async function resolveContestTargetsFromInteractionOrReply(options: {
  interaction: ChatInputCommandInteraction & ContestTargetsInteraction;
  userOptions: User[];
  handleInputs: string[];
  correlationId: string;
  store: ContestTargetStore;
  maxLinkedHandles?: number;
}): Promise<{ status: "ok"; targets: TargetHandle[] } | { status: "replied" }> {
  const { interaction, ...rest } = options;
  return resolveContestTargetsOrReply({
    interaction,
    guild: interaction.guild,
    guildId: interaction.guildId,
    user: interaction.user,
    commandName: interaction.commandName,
    ...rest,
  });
}

export async function resolveContestTargetsFromContextOrReply(options: {
  interaction: ChatInputCommandInteraction & ContestTargetsInteraction;
  targetInputs: { userOptions: User[]; handleInputs: string[] };
  correlationId: string;
  store: ContestTargetStore;
  maxLinkedHandles?: number;
}): Promise<TargetHandle[] | null> {
  const result = await resolveContestTargetsFromInteractionOrReply({
    interaction: options.interaction,
    ...options.targetInputs,
    correlationId: options.correlationId,
    store: options.store,
    maxLinkedHandles: options.maxLinkedHandles,
  });
  if (result.status === "replied") {
    return null;
  }
  return result.targets;
}
