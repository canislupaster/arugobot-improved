import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Problem } from "../services/problems.js";
import type { StoreService } from "../services/store.js";
import { logCommandError } from "../utils/commandLogging.js";
import { parseProblemReference } from "../utils/problemReference.js";
import { getColor } from "../utils/rating.js";

import type { Command } from "./types.js";

const MAX_HANDLES_CHECK = 10;
const MAX_SOLVED_DISPLAY = 10;

type SolvedSummary = {
  solvedBy: string[];
  checkedHandles: number;
  skippedHandles: number;
  staleHandles: number;
  unavailableHandles: number;
  totalLinked: number;
};

function buildProblemLink(problem: Problem): string {
  return `https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`;
}

async function getSolvedSummary(
  store: StoreService,
  guildId: string,
  problemId: string
): Promise<SolvedSummary> {
  const linkedUsers = await store.getLinkedUsers(guildId);
  const limitedUsers = linkedUsers.slice(0, MAX_HANDLES_CHECK);
  const skippedHandles = Math.max(0, linkedUsers.length - limitedUsers.length);
  const solvedBy: string[] = [];
  let staleHandles = 0;
  let unavailableHandles = 0;
  let checkedHandles = 0;

  for (const user of limitedUsers) {
    const solvedResult = await store.getSolvedProblemsResult(user.handle);
    if (!solvedResult) {
      unavailableHandles += 1;
      continue;
    }
    checkedHandles += 1;
    if (solvedResult.isStale) {
      staleHandles += 1;
    }
    if (solvedResult.solved.includes(problemId)) {
      solvedBy.push(`<@${user.userId}>`);
    }
  }

  return {
    solvedBy,
    checkedHandles,
    skippedHandles,
    staleHandles,
    unavailableHandles,
    totalLinked: linkedUsers.length,
  };
}

export const problemCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("problem")
    .setDescription("Shows details for a Codeforces problem")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("Problem id or Codeforces URL (e.g. 1000A)")
        .setRequired(true)
    ),
  async execute(interaction, context) {
    const rawReference = interaction.options.getString("id", true);
    const reference = parseProblemReference(rawReference);
    if (!reference) {
      await interaction.reply({
        content: "Invalid problem reference. Use an id like 1000A or a Codeforces URL.",
      });
      return;
    }

    await interaction.deferReply();

    try {
      const problems = await context.services.problems.ensureProblemsLoaded();
      if (problems.length === 0) {
        await interaction.editReply("Problem cache not ready yet. Try again in a bit.");
        return;
      }

      const problem = context.services.problems.getProblemDict().get(reference.id);
      if (!problem) {
        await interaction.editReply("Problem not found in the cache. Double-check the id.");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`${problem.index}. ${problem.name}`)
        .setDescription(`[Open on Codeforces](${buildProblemLink(problem)})`)
        .setColor(problem.rating ? getColor(problem.rating) : 0x3498db)
        .addFields(
          { name: "Problem id", value: `${problem.contestId}${problem.index}`, inline: true },
          {
            name: "Rating",
            value: problem.rating ? String(problem.rating) : "Unrated",
            inline: true,
          },
          {
            name: "Tags",
            value: problem.tags.length > 0 ? problem.tags.join(", ") : "None",
            inline: false,
          }
        );

      if (interaction.guild) {
        const summary = await getSolvedSummary(
          context.services.store,
          interaction.guild.id,
          reference.id
        );
        if (summary.totalLinked > 0) {
          let solvedValue = "No linked users have solved this yet.";
          if (summary.checkedHandles === 0) {
            solvedValue = "No solved data available.";
          } else if (summary.solvedBy.length > 0) {
            const displayed = summary.solvedBy.slice(0, MAX_SOLVED_DISPLAY);
            const extra = summary.solvedBy.length - displayed.length;
            solvedValue = displayed.join(", ");
            if (extra > 0) {
              solvedValue += ` and ${extra} more`;
            }
          }

          embed.addFields({
            name: `Solved by (${summary.solvedBy.length}/${summary.checkedHandles} checked)`,
            value: solvedValue,
            inline: false,
          });

          const notes = [];
          if (summary.skippedHandles > 0) {
            notes.push(`${summary.skippedHandles} handle(s) skipped`);
          }
          if (summary.staleHandles > 0) {
            notes.push(`${summary.staleHandles} handle(s) stale`);
          }
          if (summary.unavailableHandles > 0) {
            notes.push(`${summary.unavailableHandles} handle(s) unavailable`);
          }
          if (notes.length > 0) {
            embed.setFooter({ text: notes.join(" • ") });
          }
        }
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logCommandError(`Error in problem: ${String(error)}`, interaction, context.correlationId);
      await interaction.editReply("Something went wrong.");
    }
  },
};
