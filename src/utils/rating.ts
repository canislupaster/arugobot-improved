import { Colors } from "discord.js";

export function getRatingChanges(oldRating: number, problemRating: number, length: number): [number, number] {
  const adjusted = problemRating + 50 * ((80 - length) / 20);
  const magnitude = 16;
  const expected = 1 / (1 + 10 ** ((adjusted - oldRating) / 500));
  const down = -Math.min(magnitude * 10, Math.floor((0.5 * magnitude) / (1 - expected)));
  const up = Math.min(magnitude * 10, Math.floor((0.5 * magnitude) / (1.15 * expected)));
  return [down, up];
}

export function getColor(rating: number): number {
  if (rating < 1200) return Colors.LightGrey;
  if (rating < 1400) return Colors.Green;
  if (rating < 1600) return Colors.Aqua;
  if (rating < 1900) return Colors.Blue;
  if (rating < 2100) return Colors.Purple;
  if (rating < 2300) return Colors.Yellow;
  if (rating < 2400) return Colors.Orange;
  if (rating < 2600) return Colors.Red;
  if (rating < 3000) return 0xff69b4;
  return 0xadd8e6;
}

export function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
