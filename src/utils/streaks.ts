export function formatStreakEmojis(streak: number, maxEmojis = 5): string {
  if (!Number.isFinite(streak) || streak <= 0 || maxEmojis <= 0) {
    return "";
  }
  const count = Math.min(maxEmojis, Math.floor(streak));
  return "🔥".repeat(count);
}
