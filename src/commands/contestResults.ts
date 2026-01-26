import { SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import {
  buildContestEmbed,
  buildContestMatchEmbed,
  formatContestTag,
  resolveContestLookup,
} from "../utils/contestLookup.js";
import { parseContestScope, refreshContestData } from "../utils/contestScope.js";
import {
  getUserOptions,
  resolveContestTargets,
  type TargetHandle,
} from "../utils/contestTargets.js";
import { parseHandleList } from "../utils/handles.js";

import type { Command } from "./types.js";

const MAX_MATCHES = 5;
const MAX_HANDLES = 50;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
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
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Which contests to search")
        .addChoices(
          { name: "Official", value: "official" },
          { name: "Gym", value: "gym" },
          { name: "All", value: "all" }
        )
    ),
  async execute(interaction, context) {
    const queryRaw = interaction.options.getString("query", true).trim();
    const handlesRaw = interaction.options.getString("handles")?.trim() ?? "";
    const scope = parseContestScope(interaction.options.getString("scope"));
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
      });
      return;
    }

    if (!interaction.guild && handleInputs.length === 0) {
      await interaction.reply({
        content: "Provide at least one handle or run this command in a server.",
      });
      return;
    }

    await interaction.deferReply();

    const refreshResult = await refreshContestData(context.services.contests, scope);
    if ("error" in refreshResult) {
      await interaction.editReply(refreshResult.error);
      return;
    }
    const stale = refreshResult.stale;

    try {
      const lookup = resolveContestLookup(
        queryRaw,
        scope,
        context.services.contests,
        MAX_MATCHES
      );
      switch (lookup.status) {
        case "missing_latest":
          await interaction.editReply("No finished contests found yet.");
          return;
        case "missing_id":
          await interaction.editReply("No contest found with that ID.");
          return;
        case "missing_name":
          await interaction.editReply("No contests found matching that name.");
          return;
        case "ambiguous": {
          const embed = buildContestMatchEmbed({
            query: queryRaw,
            matches: lookup.matches,
            scope,
            footerText: "Use /contestresults with the contest ID for standings.",
          });
          if (stale) {
            embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
          }
          await interaction.editReply({ embeds: [embed] });
          return;
        }
        case "ok":
          break;
      }

      const contest = lookup.contest;

      const targetResult = await resolveContestTargets({
        guild: interaction.guild,
        guildId: interaction.guildId,
        user: interaction.user,
        commandName: interaction.commandName,
        userOptions,
        handleInputs,
        correlationId: context.correlationId,
        store: context.services.store,
        maxLinkedHandles: MAX_HANDLES,
      });
      if (targetResult.status === "error") {
        await interaction.editReply(targetResult.message);
        return;
      }
      const targetList = targetResult.targets;

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

      const embed = buildContestEmbed({
        contest,
        title: `Contest results: ${contest.name}`,
      });
      const scopeLabel = formatContestTag(contest, scope);
      if (scopeLabel) {
        embed.addFields({ name: "Section", value: scopeLabel, inline: true });
      }
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
