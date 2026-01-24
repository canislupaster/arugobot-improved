import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

import { logCommandError } from "../utils/commandLogging.js";
import { ephemeralFlags } from "../utils/discordFlags.js";
import { formatTime } from "../utils/rating.js";
import { formatDiscordRelativeTime } from "../utils/time.js";

import type { Command } from "./types.js";

const DEFAULT_LIMIT = 5;
const DEFAULT_RECENT_LIMIT = 5;
const MAX_LIMIT = 10;
const SELECT_TIMEOUT_MS = 30_000;

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildProblemLink(contestId: number, index: string, name: string): string {
  return `[${index}. ${name}](https://codeforces.com/problemset/problem/${contestId}/${index})`;
}

export const challengesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("challenges")
    .setDescription("List or cancel active challenges")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("Show active challenges in this server")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription(`Number of challenges to show (1-${MAX_LIMIT})`)
            .setMinValue(1)
            .setMaxValue(MAX_LIMIT)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("mine").setDescription("Show your active challenge (if any)")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("recent")
        .setDescription("Show recently completed challenges in this server")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription(`Number of challenges to show (1-${MAX_LIMIT})`)
            .setMinValue(1)
            .setMaxValue(MAX_LIMIT)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("cancel").setDescription("Cancel an active challenge (host or admin only)")
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ...ephemeralFlags,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "list") {
        const challenges = await context.services.challenges.listActiveChallenges(guildId);
        if (challenges.length === 0) {
          await interaction.reply({
            content: "No active challenges right now.",
            ...ephemeralFlags,
          });
          return;
        }

        const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const lines = challenges.slice(0, limit).map((challenge) => {
          const timeLeft = Math.max(0, challenge.endsAt - nowSeconds);
          const link = buildProblemLink(
            challenge.problem.contestId,
            challenge.problem.index,
            challenge.problem.name
          );
          return `- <#${challenge.channelId}> • ${link} • host <@${challenge.hostUserId}> • ${formatTime(
            timeLeft
          )} left`;
        });

        const embed = new EmbedBuilder()
          .setTitle("Active challenges")
          .setColor(0x3498db)
          .setDescription(lines.join("\n"));

        if (challenges.length > limit) {
          embed.setFooter({ text: `Showing ${limit} of ${challenges.length} active challenges.` });
        }

        await interaction.reply({ embeds: [embed], ...ephemeralFlags });
        return;
      }

      if (subcommand === "mine") {
        const challenges = await context.services.challenges.listActiveChallengesForUser(
          guildId,
          interaction.user.id
        );
        if (challenges.length === 0) {
          await interaction.reply({
            content: "You have no active challenges right now.",
            ...ephemeralFlags,
          });
          return;
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        const lines = challenges.map((challenge) => {
          const timeLeft = Math.max(0, challenge.endsAt - nowSeconds);
          const link = buildProblemLink(
            challenge.problem.contestId,
            challenge.problem.index,
            challenge.problem.name
          );
          return `- <#${challenge.channelId}> • ${link} • host <@${challenge.hostUserId}> • ${formatTime(
            timeLeft
          )} left`;
        });

        const embed = new EmbedBuilder()
          .setTitle("Your active challenges")
          .setColor(0x3498db)
          .setDescription(lines.join("\n"));

        await interaction.reply({ embeds: [embed], ...ephemeralFlags });
        return;
      }

      if (subcommand === "recent") {
        const limit = interaction.options.getInteger("limit") ?? DEFAULT_RECENT_LIMIT;
        const challenges = await context.services.challenges.listRecentCompletedChallenges(
          guildId,
          limit
        );
        if (challenges.length === 0) {
          await interaction.reply({
            content: "No completed challenges yet.",
            ...ephemeralFlags,
          });
          return;
        }

        const embed = new EmbedBuilder().setTitle("Recent challenges").setColor(0x3498db);

        for (const challenge of challenges) {
          const solved = challenge.participants.filter(
            (participant) => participant.solvedAt !== null
          );
          const total = challenge.participants.length;
          let firstSolve = "No solves";
          let firstSolvedAt = Number.POSITIVE_INFINITY;
          let firstSolverId: string | null = null;
          for (const participant of solved) {
            if (participant.solvedAt !== null && participant.solvedAt < firstSolvedAt) {
              firstSolvedAt = participant.solvedAt;
              firstSolverId = participant.userId;
            }
          }
          if (firstSolverId && Number.isFinite(firstSolvedAt)) {
            const duration = formatTime(Math.max(0, firstSolvedAt - challenge.startedAt));
            firstSolve = `<@${firstSolverId}> in ${duration}`;
          }

          const completedAt = challenge.completedAt ?? challenge.endsAt;
          const link = buildProblemLink(
            challenge.problem.contestId,
            challenge.problem.index,
            truncateLabel(challenge.problem.name, 80)
          );
          embed.addFields({
            name: link,
            value: [
              `Channel: <#${challenge.channelId}>`,
              `Host: <@${challenge.hostUserId}>`,
              `Solved: ${solved.length}/${total}`,
              `Completed: ${formatDiscordRelativeTime(completedAt)}`,
              `First solve: ${firstSolve}`,
            ].join("\n"),
            inline: false,
          });
        }

        await interaction.reply({ embeds: [embed], ...ephemeralFlags });
        return;
      }

      const challenges = await context.services.challenges.listActiveChallenges(guildId);
      if (challenges.length === 0) {
        await interaction.reply({ content: "No active challenges to cancel.", ...ephemeralFlags });
        return;
      }

      const options = challenges.slice(0, 25).map((challenge) => {
        const label = truncateLabel(`${challenge.problem.index}. ${challenge.problem.name}`, 90);
        const nowSeconds = Math.floor(Date.now() / 1000);
        const timeLeft = Math.max(0, challenge.endsAt - nowSeconds);
        const description = `<#${challenge.channelId}> • ${formatTime(timeLeft)} left`;
        return new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setDescription(description)
          .setValue(challenge.id);
      });

      const selectId = `challenge_cancel_${interaction.id}`;
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(selectId)
          .setPlaceholder("Select a challenge to cancel")
          .addOptions(options)
      );

      const embed = new EmbedBuilder()
        .setTitle("Cancel a challenge")
        .setColor(0xe67e22)
        .setDescription("Select the active challenge you want to cancel.");

      const response = await interaction.reply({
        embeds: [embed],
        components: [row],
        ...ephemeralFlags,
        fetchReply: true,
      });

      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: SELECT_TIMEOUT_MS,
      });

      collector.on("collect", async (selection) => {
        if (selection.customId !== selectId) {
          return;
        }
        const selectedId = selection.values[0];
        const selected = challenges.find((challenge) => challenge.id === selectedId);
        if (!selected) {
          await selection.reply({
            content: "That challenge is no longer active.",
            ...ephemeralFlags,
          });
          return;
        }

        const isAdmin = selection.memberPermissions?.has(PermissionFlagsBits.Administrator);
        const isHost = selection.user.id === selected.hostUserId;
        if (!isAdmin && !isHost) {
          await selection.reply({
            content: "Only the host or an admin can cancel this challenge.",
            ...ephemeralFlags,
          });
          return;
        }

        const cancelled = await context.services.challenges.cancelChallenge(
          selected.id,
          selection.user.id,
          context.client
        );
        if (!cancelled) {
          await selection.update({
            content: "Challenge already ended or could not be cancelled.",
            embeds: [],
            components: [],
          });
          collector.stop("handled");
          return;
        }

        await selection.update({
          content: "Challenge cancelled.",
          embeds: [],
          components: [],
        });
        collector.stop("handled");
      });

      collector.on("end", async (_collected, reason) => {
        if (reason === "handled") {
          return;
        }
        await interaction.editReply({
          content: "No selection received. No challenges were cancelled.",
          embeds: [],
          components: [],
        });
      });
    } catch (error) {
      logCommandError(`Error in challenges: ${String(error)}`, interaction, context.correlationId);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Something went wrong.", ...ephemeralFlags });
      } else {
        await interaction.reply({ content: "Something went wrong.", ...ephemeralFlags });
      }
    }
  },
};
