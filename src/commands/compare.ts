import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { normalizeHandleKey, parseHandleList } from "../utils/handles.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_TARGETS = 5;

type CompareTarget = {
  userId?: string;
  handle: string;
  botRating: number | null;
};

type TargetResolution = {
  targets: CompareTarget[];
  error?: string;
};

function addTarget(targets: CompareTarget[], seenHandles: Set<string>, target: CompareTarget) {
  const normalized = normalizeHandleKey(target.handle);
  if (seenHandles.has(normalized)) {
    return;
  }
  seenHandles.add(normalized);
  targets.push(target);
}

async function resolveUserTargets(
  users: Array<{ id: string }>,
  guildId: string,
  store: Parameters<Command["execute"]>[1]["services"]["store"],
  seenHandles: Set<string>
): Promise<TargetResolution> {
  const targets: CompareTarget[] = [];
  for (const user of users) {
    const handle = await store.getHandle(guildId, user.id);
    if (!handle) {
      return { targets: [], error: `User <@${user.id}> does not have a linked handle.` };
    }
    const rating = await store.getRating(guildId, user.id);
    addTarget(targets, seenHandles, {
      userId: user.id,
      handle,
      botRating: Number.isFinite(rating) && rating >= 0 ? rating : null,
    });
  }
  return { targets };
}

async function resolveHandleTargets(
  handleInputs: string[],
  store: Parameters<Command["execute"]>[1]["services"]["store"],
  seenHandles: Set<string>
): Promise<TargetResolution> {
  const targets: CompareTarget[] = [];
  for (const handleInput of handleInputs) {
    const resolved = await store.resolveHandle(handleInput);
    if (!resolved.exists) {
      return { targets: [], error: `Invalid handle: ${handleInput}` };
    }
    const handle = resolved.canonicalHandle ?? handleInput;
    addTarget(targets, seenHandles, { handle, botRating: null });
  }
  return { targets };
}

function buildProfileLines(
  target: CompareTarget,
  profile: Awaited<ReturnType<Parameters<Command["execute"]>[1]["services"]["store"]["getCodeforcesProfile"]>>
) {
  const cfRating =
    profile?.profile.rating !== null && profile?.profile.rating !== undefined
      ? `${profile.profile.rating} (${profile.profile.rank ?? "unrated"})`
      : "Unrated";
  const cfMax =
    profile?.profile.maxRating !== null && profile?.profile.maxRating !== undefined
      ? `${profile.profile.maxRating} (${profile.profile.maxRank ?? "unknown"})`
      : "N/A";
  const cfLastOnline = profile?.profile.lastOnlineTimeSeconds
    ? formatDiscordRelativeTime(profile.profile.lastOnlineTimeSeconds)
    : "Unknown";
  const botRating = target.botRating ?? "N/A";

  return [
    target.userId ? `User: <@${target.userId}>` : null,
    `Handle: ${target.handle}`,
    `Bot rating: ${botRating}`,
    `CF rating: ${cfRating}`,
    `CF max: ${cfMax}`,
    `Last online: ${cfLastOnline}`,
  ].filter((line): line is string => Boolean(line));
}

export const compareCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("compare")
    .setDescription("Compare Codeforces stats for users or handles")
    .addUserOption((option) => option.setName("user1").setDescription("User to compare"))
    .addUserOption((option) => option.setName("user2").setDescription("Another user to compare"))
    .addUserOption((option) => option.setName("user3").setDescription("Another user to compare"))
    .addUserOption((option) => option.setName("user4").setDescription("Another user to compare"))
    .addStringOption((option) =>
      option.setName("handles").setDescription("Comma or space separated handles to compare")
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    const userOptions = [
      interaction.options.getUser("user1"),
      interaction.options.getUser("user2"),
      interaction.options.getUser("user3"),
      interaction.options.getUser("user4"),
    ].filter(Boolean);

    const handlesRaw = interaction.options.getString("handles")?.trim() ?? "";
    const handleInputs = parseHandleList(handlesRaw);

    if (userOptions.length === 0 && handleInputs.length === 0) {
      userOptions.push(interaction.user);
    }

    if (userOptions.length + handleInputs.length > MAX_TARGETS) {
      await interaction.reply({
        content: `Too many targets. Limit is ${MAX_TARGETS}.`,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const targets: CompareTarget[] = [];
      const seenHandles = new Set<string>();

      const userTargetResolution = await resolveUserTargets(
        userOptions as Array<{ id: string }>,
        interaction.guild.id,
        context.services.store,
        seenHandles
      );
      if (userTargetResolution.error) {
        await interaction.editReply(userTargetResolution.error);
        return;
      }
      targets.push(...userTargetResolution.targets);

      const handleTargetResolution = await resolveHandleTargets(
        handleInputs,
        context.services.store,
        seenHandles
      );
      if (handleTargetResolution.error) {
        await interaction.editReply(handleTargetResolution.error);
        return;
      }
      targets.push(...handleTargetResolution.targets);

      if (targets.length === 0) {
        await interaction.editReply("No valid handles found to compare.");
        return;
      }

      const embed = new EmbedBuilder().setTitle("Codeforces comparison").setColor(EMBED_COLORS.info);

      let stale = false;
      for (const target of targets) {
        const profile = await context.services.store.getCodeforcesProfile(target.handle);
        if (profile?.isStale) {
          stale = true;
        }
        const lines = buildProfileLines(target, profile);

        embed.addFields({
          name: target.handle,
          value: lines.join("\n"),
          inline: false,
        });
      }

      if (stale) {
        embed.setFooter({ text: "Some Codeforces data may be stale." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in compare: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
