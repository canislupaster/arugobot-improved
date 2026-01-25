import { EmbedBuilder, SlashCommandBuilder, type User } from "discord.js";

import type { Contest } from "../services/contests.js";
import { logCommandError } from "../utils/commandLogging.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import { ephemeralFlags } from "../utils/discordFlags.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatDuration,
} from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_MATCHES = 5;
const MAX_HANDLES = 50;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

type TargetHandle = {
  handle: string;
  label: string;
};

function parseHandleList(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseContestId(raw: string): number | null {
  const trimmed = raw.trim();
  const urlMatch = trimmed.match(/\bcontests?\/(\d+)/i);
  if (urlMatch) {
    const id = Number(urlMatch[1]);
    return Number.isFinite(id) ? id : null;
  }
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    return Number.isFinite(id) ? id : null;
  }
  return null;
}

const LATEST_CONTEST_QUERIES = new Set(["latest", "last", "recent"]);

function isLatestQuery(raw: string): boolean {
  return LATEST_CONTEST_QUERIES.has(raw.trim().toLowerCase());
}

function formatPhase(phase: Contest["phase"]): string {
  switch (phase) {
    case "BEFORE":
      return "Upcoming";
    case "CODING":
      return "Ongoing";
    case "FINISHED":
      return "Finished";
    case "PENDING_SYSTEM_TEST":
      return "Pending system test";
    case "SYSTEM_TEST":
      return "System test";
    default:
      return phase;
  }
}

function formatParticipantType(type: string): string {
  switch (type) {
    case "OUT_OF_COMPETITION":
      return "OOC";
    case "VIRTUAL":
      return "Virtual";
    case "PRACTICE":
      return "Practice";
    default:
      return type;
  }
}

function formatPoints(points: number): string {
  if (!Number.isFinite(points)) {
    return "0";
  }
  if (Number.isInteger(points)) {
    return String(points);
  }
  return points.toFixed(2);
}

function buildMatchEmbed(query: string, matches: Contest[]): EmbedBuilder {
  const lines = matches
    .map((contest) => {
      const when = formatDiscordRelativeTime(contest.startTimeSeconds);
      return `- ${contest.name} (ID ${contest.id}, ${when})`;
    })
    .join("\n");

  return new EmbedBuilder()
    .setTitle("Contest matches")
    .setColor(0x3498db)
    .setDescription(`Results for "${query}":\n${lines}`)
    .setFooter({ text: "Use /contestresults with the contest ID for standings." });
}

function buildContestEmbed(contest: Contest): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Contest results: ${contest.name}`)
    .setColor(0x3498db)
    .setDescription(`[Open contest](${buildContestUrl(contest)})`)
    .addFields(
      { name: "Contest ID", value: String(contest.id), inline: true },
      { name: "Status", value: formatPhase(contest.phase), inline: true },
      {
        name: "Starts",
        value: `${formatDiscordTimestamp(contest.startTimeSeconds)} (${formatDiscordRelativeTime(
          contest.startTimeSeconds
        )})`,
        inline: false,
      },
      { name: "Duration", value: formatDuration(contest.durationSeconds), inline: true }
    );

  if (contest.phase === "CODING") {
    const endsAt = contest.startTimeSeconds + contest.durationSeconds;
    embed.addFields({
      name: "Ends",
      value: `${formatDiscordTimestamp(endsAt)} (${formatDiscordRelativeTime(endsAt)})`,
      inline: true,
    });
  }

  return embed;
}

function buildTargetHandles(existing: Map<string, TargetHandle>, handle: string, label: string) {
  const key = handle.toLowerCase();
  if (existing.has(key)) {
    return;
  }
  existing.set(key, { handle, label });
}

function getUserOptions(users: Array<User | null | undefined>): User[] {
  return users.filter((user): user is User => Boolean(user));
}

export const contestResultsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contestresults")
    .setDescription("Shows standings for linked users in a contest")
    .addStringOption((option) =>
      option.setName("query").setDescription("Contest id, URL, name, or latest").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of results to show (1-${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    )
    .addUserOption((option) => option.setName("user1").setDescription("User to include"))
    .addUserOption((option) => option.setName("user2").setDescription("User to include"))
    .addUserOption((option) => option.setName("user3").setDescription("User to include"))
    .addUserOption((option) => option.setName("user4").setDescription("User to include"))
    .addStringOption((option) =>
      option.setName("handles").setDescription("Comma or space separated handles to include")
    ),
  async execute(interaction, context) {
    const queryRaw = interaction.options.getString("query", true).trim();
    const handlesRaw = interaction.options.getString("handles")?.trim() ?? "";
    const handleInputs = parseHandleList(handlesRaw);
    const userOptions = getUserOptions([
      interaction.options.getUser("user1"),
      interaction.options.getUser("user2"),
      interaction.options.getUser("user3"),
      interaction.options.getUser("user4"),
    ]);

    if (!interaction.guild && userOptions.length > 0) {
      await interaction.reply({
        content: "Specify handles directly when using this command outside a server.",
        ...ephemeralFlags,
      });
      return;
    }

    if (!interaction.guild && handleInputs.length === 0) {
      await interaction.reply({
        content: "Provide at least one handle or run this command in a server.",
        ...ephemeralFlags,
      });
      return;
    }

    await interaction.deferReply({ ...ephemeralFlags });

    let stale = false;
    try {
      await context.services.contests.refresh();
    } catch {
      if (context.services.contests.getLastRefreshAt() > 0) {
        stale = true;
      } else {
        await interaction.editReply(
          "Unable to reach Codeforces right now. Try again in a few minutes."
        );
        return;
      }
    }

    try {
      const wantsLatest = isLatestQuery(queryRaw);
      const contestId = parseContestId(queryRaw);
      let contest: Contest | null = null;
      if (wantsLatest) {
        contest = context.services.contests.getLatestFinished();
        if (!contest) {
          await interaction.editReply("No finished contests found yet.");
          return;
        }
      } else if (contestId) {
        contest = context.services.contests.getContestById(contestId);
        if (!contest) {
          await interaction.editReply("No contest found with that ID.");
          return;
        }
      } else {
        const matches = context.services.contests.searchContests(queryRaw, MAX_MATCHES);
        if (matches.length === 0) {
          await interaction.editReply("No contests found matching that name.");
          return;
        }
        if (matches.length > 1) {
          const embed = buildMatchEmbed(queryRaw, matches);
          if (stale) {
            embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
          }
          await interaction.editReply({ embeds: [embed] });
          return;
        }
        contest = matches[0] ?? null;
      }

      if (!contest) {
        await interaction.editReply("No contest found for that query.");
        return;
      }

      const targets = new Map<string, TargetHandle>();

      if (userOptions.length > 0 || handleInputs.length > 0) {
        if (interaction.guild) {
          for (const user of userOptions) {
            const handle = await context.services.store.getHandle(interaction.guild.id, user.id);
            if (!handle) {
              await interaction.editReply(`User <@${user.id}> does not have a linked handle.`);
              return;
            }
            buildTargetHandles(targets, handle, `<@${user.id}>`);
          }
        }

        for (const handleInput of handleInputs) {
          const resolved = await context.services.store.resolveHandle(handleInput);
          if (!resolved.exists) {
            await interaction.editReply(`Invalid handle: ${handleInput}`);
            return;
          }
          const handle = resolved.canonicalHandle ?? handleInput;
          buildTargetHandles(targets, handle, handle);
        }
      } else {
        const guildId = interaction.guild?.id ?? "";
        const linkedUsers = await context.services.store.getLinkedUsers(guildId);
        if (linkedUsers.length === 0) {
          await interaction.editReply("No linked handles found in this server yet.");
          return;
        }
        if (linkedUsers.length > MAX_HANDLES) {
          await interaction.editReply(
            `Too many linked handles (${linkedUsers.length}). Provide specific handles or users.`
          );
          return;
        }
        for (const linked of linkedUsers) {
          buildTargetHandles(targets, linked.handle, `<@${linked.userId}>`);
        }
      }

      const targetList = Array.from(targets.values());
      if (targetList.length === 0) {
        await interaction.editReply("No handles found to check.");
        return;
      }

      const standings = await context.services.contestStandings.getStandings(
        contest.id,
        targetList.map((target) => target.handle),
        contest.phase
      );

      const entryMap = new Map(
        standings.entries.map((entry) => [entry.handle.toLowerCase(), entry])
      );

      const found: Array<
        TargetHandle & {
          rank: number;
          points: number;
          penalty: number;
          participantType: string;
        }
      > = [];
      const missing: TargetHandle[] = [];

      for (const target of targetList) {
        const entry = entryMap.get(target.handle.toLowerCase());
        if (!entry) {
          missing.push(target);
          continue;
        }
        found.push({ ...target, ...entry });
      }

      const embed = buildContestEmbed(contest);
      const footerNotes: string[] = [];

      if (found.length === 0) {
        embed.addFields({
          name: "Standings",
          value:
            contest.phase === "BEFORE"
              ? "Contest has not started yet."
              : "No standings found for the selected handles.",
          inline: false,
        });
      } else {
        const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
        const sorted = found.sort((a, b) => a.rank - b.rank);
        const lines = sorted.slice(0, limit).map((entry) => {
          const display = entry.label.startsWith("<@")
            ? `${entry.label} (${entry.handle})`
            : entry.label;
          const rank = entry.rank > 0 ? `#${entry.rank}` : "Unranked";
          const points = formatPoints(entry.points);
          const penalty = Number.isFinite(entry.penalty) ? String(entry.penalty) : "0";
          const typeLabel =
            entry.participantType && entry.participantType !== "CONTESTANT"
              ? ` • ${formatParticipantType(entry.participantType)}`
              : "";
          return `${rank} ${display} • ${points} pts • ${penalty} pen${typeLabel}`;
        });

        embed.addFields({ name: "Standings", value: lines.join("\n"), inline: false });

        if (found.length > limit) {
          footerNotes.push(`Showing top ${limit} of ${found.length} entries.`);
        }
      }

      if (missing.length > 0) {
        const preview = missing
          .slice(0, 10)
          .map((entry) => entry.label)
          .join(", ");
        const suffix = missing.length > 10 ? `\n...and ${missing.length - 10} more.` : "";
        embed.addFields({
          name: "Not found",
          value: `${preview}${suffix}`,
          inline: false,
        });
      }

      if (stale || standings.isStale) {
        footerNotes.push("Showing cached data due to a temporary Codeforces error.");
      }

      if (footerNotes.length > 0) {
        embed.setFooter({ text: footerNotes.join(" ") });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(
        `Error in contestresults: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
