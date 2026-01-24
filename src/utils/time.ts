export function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatDiscordTimestamp(unixSeconds: number): string {
  return `<t:${unixSeconds}:F>`;
}

export function formatDiscordRelativeTime(unixSeconds: number): string {
  return `<t:${unixSeconds}:R>`;
}
