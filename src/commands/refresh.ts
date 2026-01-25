import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { EMBED_COLORS } from "../utils/embedColors.js";

import type { Command } from "./types.js";

type RefreshScope = "all" | "contests" | "handles" | "problems";

function resolveScope(raw: string | null): RefreshScope {
  if (raw === "contests" || raw === "handles" || raw === "problems") {
    return raw;
  }
  return "all";
}

type RefreshTask = {
  label: string;
  run: () => Promise<string>;
  errorMessage: string;
  errorLog: string;
};

async function runRefreshTask(
  task: RefreshTask,
  embed: EmbedBuilder,
  errors: string[],
  interaction: Parameters<Command["execute"]>[0],
  correlationId: string
): Promise<void> {
  try {
    const value = await task.run();
    embed.addFields({ name: task.label, value, inline: true });
  } catch (error) {
    errors.push(task.errorMessage);
    logCommandError(`${task.errorLog}: ${String(error)}`, interaction, correlationId);
  }
}

export const refreshCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Refresh cached Codeforces data for this bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("What to refresh")
        .addChoices(
          { name: "All", value: "all" },
          { name: "Problems", value: "problems" },
          { name: "Contests", value: "contests" },
          { name: "Handles", value: "handles" }
        )
    ),
  adminOnly: true,
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const scope = resolveScope(interaction.options.getString("scope"));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const embed = new EmbedBuilder().setTitle("Refresh results").setColor(EMBED_COLORS.info);
    const errors: string[] = [];
    const refreshAll = scope === "all";
    const tasks: Record<Exclude<RefreshScope, "all">, RefreshTask> = {
      problems: {
        label: "Problems",
        run: async () => {
          await context.services.problems.refreshProblems(true);
          const count = context.services.problems.getProblems().length;
          return `${count} cached`;
        },
        errorMessage: "Problem cache refresh failed.",
        errorLog: "Problem refresh failed",
      },
      contests: {
        label: "Contests",
        run: async () => {
          await context.services.contests.refresh(true);
          const upcoming = context.services.contests.getUpcomingContests().length;
          const ongoing = context.services.contests.getOngoing().length;
          return `${upcoming} upcoming, ${ongoing} ongoing`;
        },
        errorMessage: "Contest cache refresh failed.",
        errorLog: "Contest refresh failed",
      },
      handles: {
        label: "Handles",
        run: async () => {
          const summary = await context.services.store.refreshHandles();
          return `${summary.updated} updated (${summary.checked} checked)`;
        },
        errorMessage: "Handle refresh failed.",
        errorLog: "Handle refresh failed",
      },
    };

    if (refreshAll || scope === "problems") {
      await runRefreshTask(tasks.problems, embed, errors, interaction, context.correlationId);
    }
    if (refreshAll || scope === "contests") {
      await runRefreshTask(tasks.contests, embed, errors, interaction, context.correlationId);
    }
    if (refreshAll || scope === "handles") {
      await runRefreshTask(tasks.handles, embed, errors, interaction, context.correlationId);
    }

    if (errors.length > 0) {
      embed.addFields({ name: "Errors", value: errors.join("\n"), inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
