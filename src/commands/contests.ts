import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { formatDiscordRelativeTime, formatDiscordTimestamp, formatDuration } from "../utils/time.js";

import type { Command } from "./types.js";

const MAX_CONTESTS = 5;

function buildContestLine(contest: { id: number; name: string }, timing: string) {
  return `- [${contest.name}](https://codeforces.com/contest/${contest.id}) ${timing}`;
}

export const contestsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("contests")
    .setDescription("Shows upcoming and ongoing Codeforces contests")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of upcoming contests to show (1-${MAX_CONTESTS})`)
        .setMinValue(1)
        .setMaxValue(MAX_CONTESTS)
    ),
  async execute(interaction, context) {
    const limit = interaction.options.getInteger("limit") ?? MAX_CONTESTS;
    await interaction.deferReply();

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

    const ongoing = context.services.contests.getOngoing();
    const upcoming = context.services.contests.getUpcoming(limit);

    if (ongoing.length === 0 && upcoming.length === 0) {
      await interaction.editReply("No Codeforces contests found.");
      return;
    }

    const embed = new EmbedBuilder().setTitle("Codeforces Contests").setColor(0x3498db);

    if (ongoing.length > 0) {
      const ongoingLines = ongoing
        .map((contest) => {
          const endsAt = contest.startTimeSeconds + contest.durationSeconds;
          return buildContestLine(
            contest,
            `(ends ${formatDiscordRelativeTime(endsAt)})`
          );
        })
        .join("\n");
      embed.addFields({ name: "Ongoing", value: ongoingLines, inline: false });
    }

    if (upcoming.length > 0) {
      const upcomingLines = upcoming
        .map((contest) =>
          buildContestLine(
            contest,
            `(starts ${formatDiscordRelativeTime(contest.startTimeSeconds)} • ${formatDuration(
              contest.durationSeconds
            )} • ${formatDiscordTimestamp(contest.startTimeSeconds)})`
          )
        )
        .join("\n");
      embed.addFields({ name: "Upcoming", value: upcomingLines, inline: false });
    }

    if (stale) {
      embed.setFooter({ text: "Showing cached data due to a temporary Codeforces error." });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
