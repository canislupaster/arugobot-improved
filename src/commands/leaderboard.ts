import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";

import type { Command } from "./types.js";

export const leaderboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Shows the server leaderboard")
    .addStringOption((option) =>
      option
        .setName("metric")
        .setDescription("What to rank")
        .addChoices({ name: "Rating", value: "rating" }, { name: "Solves", value: "solves" })
    )
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number (starting at 1)").setMinValue(1)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
      });
      return;
    }
    const guild = interaction.guild;
    const page = interaction.options.getInteger("page") ?? 1;
    const metric = interaction.options.getString("metric") ?? "rating";
    if (!Number.isInteger(page) || page < 1) {
      await interaction.reply({ content: "Invalid page." });
      return;
    }

    await interaction.deferReply();

    const renderLeaderboard = async (
      rows: Array<{ userId: string; value: number }>,
      title: string,
      fieldName: string
    ) => {
      let content = "";
      const start = (page - 1) * 10;
      if (start >= rows.length) {
        await interaction.editReply("Empty page.");
        return;
      }
      for (let i = 0; i < 10; i += 1) {
        const index = start + i;
        if (index >= rows.length) {
          break;
        }
        const entry = rows[index];
        const member = await guild.members.fetch(entry.userId).catch(() => null);
        const mention = member ? member.toString() : `<@${entry.userId}>`;
        content += `${index + 1}. ${mention} (${entry.value})`;
        if (index === 0) {
          content += " :first_place:\n";
        } else if (index === 1) {
          content += " :second_place:\n";
        } else if (index === 2) {
          content += " :third_place:\n";
        } else {
          content += "\n";
        }
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`Page ${page}`)
        .setColor(0x3498db)
        .addFields({ name: fieldName, value: content || "No entries.", inline: false });

      await interaction.editReply({ embeds: [embed] });
    };

    try {
      if (metric === "solves") {
        const leaderboard = await context.services.store.getSolveLeaderboard(interaction.guild.id);
        if (!leaderboard || leaderboard.length === 0) {
          await interaction.editReply("No solves recorded yet.");
          return;
        }
        await renderLeaderboard(
          leaderboard.map((entry) => ({ userId: entry.userId, value: entry.solvedCount })),
          "Solve leaderboard",
          "Solves"
        );
        return;
      }

      const leaderboard = await context.services.store.getLeaderboard(interaction.guild.id);
      if (!leaderboard || leaderboard.length === 0) {
        await interaction.editReply("No leaderboard entries yet.");
        return;
      }
      await renderLeaderboard(
        leaderboard.map((entry) => ({ userId: entry.userId, value: entry.rating })),
        "Leaderboard",
        "Users"
      );
    } catch (error) {
      logCommandError(
        `Error during leaderboard command: ${String(error)}`,
        interaction,
        context.correlationId
      );
      await interaction.editReply("Something went wrong.");
    }
  },
};
