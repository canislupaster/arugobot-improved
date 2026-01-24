import { MessageFlags } from "discord.js";

export const publicFlags = {} as const;
export const privateFlags = { flags: MessageFlags.Ephemeral } as const;
export const ephemeralFlags = publicFlags;
