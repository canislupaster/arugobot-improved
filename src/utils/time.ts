export function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

const MIN_UTC_OFFSET_MINUTES = -12 * 60;
const MAX_UTC_OFFSET_MINUTES = 14 * 60;

export function formatDiscordTimestamp(unixSeconds: number): string {
  return `<t:${unixSeconds}:F>`;
}

export function formatDiscordRelativeTime(unixSeconds: number): string {
  return `<t:${unixSeconds}:R>`;
}

export function formatHourMinute(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatUtcOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return "UTC";
  }
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeMinutes(totalMinutes: number): number {
  const modulo = 24 * 60;
  return ((totalMinutes % modulo) + modulo) % modulo;
}

export function toUtcTime(hour: number, minute: number, offsetMinutes: number) {
  const totalMinutes = normalizeMinutes(hour * 60 + minute - offsetMinutes);
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

export function toLocalTime(hour: number, minute: number, offsetMinutes: number) {
  const totalMinutes = normalizeMinutes(hour * 60 + minute + offsetMinutes);
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

export function parseUtcOffset(raw: string): { minutes: number } | { error: string } {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "Z" || trimmed === "UTC") {
    return { minutes: 0 };
  }
  const match = trimmed.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return { error: "Invalid UTC offset. Use formats like +02:00, -05:30, or Z." };
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes >= 60) {
    return { error: "Invalid UTC offset. Hours/minutes are out of range." };
  }
  const totalMinutes = sign * (hours * 60 + minutes);
  if (totalMinutes < MIN_UTC_OFFSET_MINUTES || totalMinutes > MAX_UTC_OFFSET_MINUTES) {
    return { error: "UTC offset must be between -12:00 and +14:00." };
  }
  return { minutes: totalMinutes };
}
