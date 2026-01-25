import type { MessageMentionOptions } from "discord.js";

export type RoleMentionOptions = {
  mention?: string;
  allowedMentions: MessageMentionOptions;
};

export function buildRoleMention(roleId: string | null): string | undefined {
  return roleId ? `<@&${roleId}>` : undefined;
}

export function buildRoleMentionOptions(roleId: string | null): RoleMentionOptions {
  const mention = buildRoleMention(roleId);
  const allowedMentions: MessageMentionOptions = mention ? { roles: [roleId!] } : { parse: [] };
  return { mention, allowedMentions };
}
