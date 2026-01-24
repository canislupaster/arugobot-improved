import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { getColor } from "../utils/rating.js";

import type { Command } from "./types.js";

export const suggestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Gives problems at a given rating that the handles have not solved")
    .addIntegerOption((option) =>
      option
        .setName("rating")
        .setDescription("Problem rating (multiple of 100)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("handles")
        .setDescription("Space or comma separated list of Codeforces handles (max 5)")
    ),
  async execute(interaction, context) {
    const rating = interaction.options.getInteger("rating", true);
    const rawHandles = interaction.options.getString("handles") ?? "";
    const handles = rawHandles
      .split(/[,\s]+/)
      .map((handle) => handle.trim())
      .filter(Boolean);

    if (handles.length > 5) {
      await interaction.reply({ content: "Too many people (limit is 5).", ephemeral: true });
      return;
    }
    if (rating < 800 || rating > 3500 || rating % 100 !== 0) {
      await interaction.reply({
        content: "Rating should be a multiple of 100 between 800 and 3500.",
        ephemeral: true,
      });
      return;
    }

    const problems = context.services.problems.getProblems();
    if (problems.length === 0) {
      await interaction.reply({ content: "Try again in a bit.", ephemeral: true });
      return;
    }

    const possibleProblems = problems.filter((problem) => problem.rating === rating);
    const solvedLists: string[][] = [];
    const badHandles: string[] = [];

    for (const handle of handles) {
      if (await context.services.store.handleExistsOnCf(handle)) {
        const solved = await context.services.store.getSolvedProblems(handle);
        if (!solved) {
          await interaction.reply({
            content: "Something went wrong. Try again in a bit.",
            ephemeral: true,
          });
          return;
        }
        solvedLists.push(solved);
      } else {
        badHandles.push(handle);
      }
    }

    if (badHandles.length > 0) {
      await interaction.reply({
        content: `Invalid handle(s) (will be ignored): ${badHandles.join(", ")}.`,
        ephemeral: true,
      });
    }

    let attempts = 0;
    let suggestions: typeof possibleProblems = [];
    const remaining = [...possibleProblems];

    while (attempts < 100 && suggestions.length < 10 && remaining.length > 0) {
      const index = Math.floor(Math.random() * remaining.length);
      const [problem] = remaining.splice(index, 1);
      const id = `${problem.contestId}${problem.index}`;
      if (solvedLists.every((list) => !list.includes(id))) {
        suggestions.push(problem);
      }
      attempts += 1;
    }

    if (suggestions.length < 10) {
      const problemMap = new Map(
        remaining.map((problem) => [`${problem.contestId}${problem.index}`, problem])
      );
      for (const list of solvedLists) {
        for (const problemId of list) {
          problemMap.delete(problemId);
        }
      }
      suggestions = Array.from(problemMap.values());
      for (let i = suggestions.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [suggestions[i], suggestions[j]] = [suggestions[j], suggestions[i]];
      }
    }

    let description = "";
    for (let i = 0; i < Math.min(10, suggestions.length); i += 1) {
      const problem = suggestions[i];
      description += `- [${problem.contestId}${problem.index}. ${problem.name}](https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index})`;
      if (i !== Math.min(10, suggestions.length) - 1) {
        description += "\n";
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("Problem suggestions")
      .setDescription(description || "No suggestions found.")
      .setColor(getColor(rating));

    if (badHandles.length > 0) {
      await interaction.followUp({ embeds: [embed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [embed] });
    }
  },
};
