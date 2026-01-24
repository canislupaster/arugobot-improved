import { Chart, registerables, type ChartConfiguration, type ChartOptions, type Plugin } from "chart.js";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { logError } from "../utils/logger.js";

import type { Command } from "./types.js";

Chart.register(...registerables);

const width = 900;
const height = 450;
const chartCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: "white" });

const ratingBands = [
  { min: -1000, max: 1200, color: "rgba(128,128,128,0.5)" },
  { min: 1200, max: 1400, color: "rgba(0,255,0,0.4)" },
  { min: 1400, max: 1600, color: "rgba(0,255,255,0.4)" },
  { min: 1600, max: 1900, color: "rgba(0,0,255,0.4)" },
  { min: 1900, max: 2100, color: "rgba(128,0,128,0.4)" },
  { min: 2100, max: 2300, color: "rgba(255,255,0,0.4)" },
  { min: 2300, max: 2400, color: "rgba(255,165,0,0.5)" },
  { min: 2400, max: 2600, color: "rgba(255,0,0,0.5)" },
  { min: 2600, max: 3000, color: "rgba(255,105,180,0.6)" },
  { min: 3000, max: 5000, color: "rgba(255,0,255,0.4)" },
];

const bandPlugin: Plugin<"line"> = {
  id: "ratingBands",
  beforeDraw: (chart: Chart) => {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) {
      return;
    }
    for (const band of ratingBands) {
      const yTop = scales.y.getPixelForValue(band.max);
      const yBottom = scales.y.getPixelForValue(band.min);
      ctx.save();
      ctx.fillStyle = band.color;
      ctx.fillRect(chartArea.left, yTop, chartArea.right - chartArea.left, yBottom - yTop);
      ctx.restore();
    }
  },
};

async function renderRatingChart(name: string, ratings: number[]): Promise<Buffer> {
  const labels = ratings.map((_, index) => String(index + 1));
  const min = Math.min(...ratings) - 100;
  const max = Math.max(...ratings) + 100;
  const ticks = [0, 1200, 1400, 1600, 1900, 2100, 2300, 2400, 2600, 3000].filter(
    (value) => value >= min && value <= max
  );

  const options: ChartOptions<"line"> = {
    responsive: false,
    scales: {
      y: {
        min,
        max,
        ticks: {
          callback: (value) => String(value),
          stepSize: 1,
        },
        afterBuildTicks: (scale) => {
          scale.ticks = ticks.map((tick) => ({ value: tick }));
        },
      },
      x: {
        ticks: {
          autoSkip: false,
        },
      },
    },
    plugins: {
      legend: { display: false },
      title: { display: true, text: `Rating history of ${name}` },
    },
  };

  const config: ChartConfiguration<"line", number[], string> = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: ratings,
          borderColor: "blue",
          backgroundColor: "blue",
          pointRadius: 4,
          pointBackgroundColor: "blue",
        },
      ],
    },
    options,
    plugins: [bandPlugin],
  };

  return chartCanvas.renderToBuffer(config);
}

export const ratingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("rating")
    .setDescription("Shows your (or another user's) rating graph")
    .addUserOption((option) => option.setName("user").setDescription("User to inspect")),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }
    const member = interaction.options.getMember("user");
    const user = interaction.options.getUser("user") ?? interaction.user;
    const targetId = user.id;
    const targetName =
      member && "displayName" in member ? member.displayName : user.username;
    const targetMention = member && "toString" in member ? member.toString() : user.toString();

    await interaction.deferReply();

    if (!(await context.services.store.handleLinked(interaction.guild.id, targetId))) {
      await interaction.editReply("Handle not linked.");
      return;
    }

    const rating = await context.services.store.getRating(interaction.guild.id, targetId);
    if (rating === -1) {
      await interaction.editReply("Something went wrong, no rating found.");
      return;
    }

    try {
      const historyData = await context.services.store.getHistoryWithRatings(
        interaction.guild.id,
        targetId
      );
      if (!historyData) {
        await interaction.editReply("No rating history yet.");
        return;
      }
      const buffer = await renderRatingChart(targetName, historyData.ratingHistory);
      const attachment = new AttachmentBuilder(buffer, { name: "rating.png" });
      const embed = new EmbedBuilder()
        .setTitle("Rating graph")
        .setDescription(`${targetMention}'s rating is ${rating}`)
        .setColor(0x3498db)
        .setImage("attachment://rating.png");

      await interaction.editReply({ files: [attachment], embeds: [embed] });
    } catch (error) {
      logError(`Something went wrong: ${String(error)}`);
      await interaction.editReply("Something went wrong.");
    }
  },
};
