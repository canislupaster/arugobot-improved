import { EmbedBuilder, type Client } from "discord.js";
import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { resolveSendableChannel } from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import { buildRoleMentionOptions } from "../utils/mentions.js";
import { formatDiscordRelativeTime, formatDiscordTimestamp } from "../utils/time.js";

import type { ContestActivityService } from "./contestActivity.js";
import type { StoreService } from "./store.js";

export type WeeklyDigestSubscription = {
  guildId: string;
  channelId: string;
  dayOfWeek: number;
  hourUtc: number;
  minuteUtc: number;
  utcOffsetMinutes: number;
  roleId: string | null;
  lastSentAt: string | null;
};

export type WeeklyDigestPreview = {
  subscription: WeeklyDigestSubscription;
  nextScheduledAt: number;
  embed: EmbedBuilder;
};

export type ManualWeeklyDigestResult =
  | { status: "sent"; channelId: string }
  | { status: "no_subscription" }
  | { status: "already_sent"; lastSentAt: string }
  | { status: "channel_missing"; channelId: string }
  | { status: "error"; message: string };

const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_RECENT_CONTESTS = 3;
const DEFAULT_PARTICIPANT_LIMIT = 5;
const DEFAULT_RATING_DELTA_LIMIT = 3;

function normalizeDayOfWeek(value: number): number {
  if (Number.isInteger(value) && value >= 0 && value <= 6) {
    return value;
  }
  return 1;
}

function normalizeUtc(value: number, max: number): number {
  if (Number.isInteger(value) && value >= 0 && value <= max) {
    return value;
  }
  return 0;
}

function getLocalWeekStartUtcMs(now: Date, offsetMinutes: number, dayOfWeek: number): number {
  const localNow = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  const localDay = localNow.getUTCDay();
  const deltaDays = (localDay - dayOfWeek + 7) % 7;
  const localStart = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate() - deltaDays,
    0,
    0,
    0,
    0
  );
  return localStart - offsetMinutes * 60 * 1000;
}

function getLocalDayForUtcMs(utcMs: number, offsetMinutes: number): number {
  return new Date(utcMs + offsetMinutes * 60 * 1000).getUTCDay();
}

export function getNextWeeklyScheduledUtcMs(
  now: Date,
  dayOfWeek: number,
  hourUtc: number,
  minuteUtc: number,
  utcOffsetMinutes: number
): number {
  const normalizedDay = normalizeDayOfWeek(dayOfWeek);
  const nowMs = now.getTime();
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidateUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + offset,
      hourUtc,
      minuteUtc,
      0,
      0
    );
    if (candidateUtc < nowMs) {
      continue;
    }
    const localDay = new Date(candidateUtc + utcOffsetMinutes * 60 * 1000).getUTCDay();
    if (localDay === normalizedDay) {
      return candidateUtc;
    }
  }
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 7,
    hourUtc,
    minuteUtc,
    0,
    0
  );
}

function formatUserLine(userId: string, count: number, label: string): string {
  return `${label} <@${userId}> • ${count}`;
}

function formatDelta(delta: number): string {
  if (!Number.isFinite(delta)) {
    return "0";
  }
  const rounded = Math.round(delta);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export class WeeklyDigestService {
  private lastTickAt: string | null = null;
  private lastError: { message: string; timestamp: string } | null = null;
  private isTicking = false;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly store: StoreService,
    private readonly contestActivity: ContestActivityService
  ) {}

  getLastTickAt(): string | null {
    return this.lastTickAt;
  }

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async getSubscription(guildId: string): Promise<WeeklyDigestSubscription | null> {
    const row = await this.db
      .selectFrom("weekly_digests")
      .select([
        "guild_id",
        "channel_id",
        "day_of_week",
        "hour_utc",
        "minute_utc",
        "utc_offset_minutes",
        "role_id",
        "last_sent_at",
      ])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    return {
      guildId: row.guild_id,
      channelId: row.channel_id,
      dayOfWeek: normalizeDayOfWeek(row.day_of_week),
      hourUtc: normalizeUtc(row.hour_utc, 23),
      minuteUtc: normalizeUtc(row.minute_utc, 59),
      utcOffsetMinutes: Number(row.utc_offset_minutes ?? 0),
      roleId: row.role_id ?? null,
      lastSentAt: row.last_sent_at ?? null,
    };
  }

  async listSubscriptions(): Promise<WeeklyDigestSubscription[]> {
    const rows = await this.db
      .selectFrom("weekly_digests")
      .select([
        "guild_id",
        "channel_id",
        "day_of_week",
        "hour_utc",
        "minute_utc",
        "utc_offset_minutes",
        "role_id",
        "last_sent_at",
      ])
      .execute();
    return rows.map((row) => ({
      guildId: row.guild_id,
      channelId: row.channel_id,
      dayOfWeek: normalizeDayOfWeek(row.day_of_week),
      hourUtc: normalizeUtc(row.hour_utc, 23),
      minuteUtc: normalizeUtc(row.minute_utc, 59),
      utcOffsetMinutes: Number(row.utc_offset_minutes ?? 0),
      roleId: row.role_id ?? null,
      lastSentAt: row.last_sent_at ?? null,
    }));
  }

  async getSubscriptionCount(): Promise<number> {
    const row = await this.db
      .selectFrom("weekly_digests")
      .select(({ fn }) => fn.count<string>("guild_id").as("count"))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async setSubscription(
    guildId: string,
    channelId: string,
    dayOfWeek: number,
    hourUtc: number,
    minuteUtc: number,
    utcOffsetMinutes: number,
    roleId: string | null
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.db
      .insertInto("weekly_digests")
      .values({
        guild_id: guildId,
        channel_id: channelId,
        day_of_week: dayOfWeek,
        hour_utc: hourUtc,
        minute_utc: minuteUtc,
        utc_offset_minutes: utcOffsetMinutes,
        role_id: roleId,
        updated_at: timestamp,
      })
      .onConflict((oc) =>
        oc.column("guild_id").doUpdateSet({
          channel_id: channelId,
          day_of_week: dayOfWeek,
          hour_utc: hourUtc,
          minute_utc: minuteUtc,
          utc_offset_minutes: utcOffsetMinutes,
          role_id: roleId,
          updated_at: timestamp,
        })
      )
      .execute();
  }

  async clearSubscription(guildId: string): Promise<void> {
    await this.db.deleteFrom("weekly_digests").where("guild_id", "=", guildId).execute();
  }

  async getPreview(guildId: string): Promise<WeeklyDigestPreview | null> {
    const subscription = await this.getSubscription(guildId);
    if (!subscription) {
      return null;
    }
    const embed = await this.buildDigestEmbed(subscription);
    const nextScheduledAt = getNextWeeklyScheduledUtcMs(
      new Date(),
      subscription.dayOfWeek,
      subscription.hourUtc,
      subscription.minuteUtc,
      subscription.utcOffsetMinutes
    );
    return { subscription, nextScheduledAt, embed };
  }

  async sendManualDigest(
    guildId: string,
    client: Client,
    force = false
  ): Promise<ManualWeeklyDigestResult> {
    const subscription = await this.getSubscription(guildId);
    if (!subscription) {
      return { status: "no_subscription" };
    }

    const now = new Date();
    const weekStart = getLocalWeekStartUtcMs(
      now,
      subscription.utcOffsetMinutes,
      subscription.dayOfWeek
    );
    const lastSentAt = subscription.lastSentAt ? Date.parse(subscription.lastSentAt) : 0;
    if (!force && Number.isFinite(lastSentAt) && lastSentAt >= weekStart) {
      return {
        status: "already_sent",
        lastSentAt: subscription.lastSentAt ?? new Date().toISOString(),
      };
    }

    const channel = await resolveSendableChannel(client, subscription.channelId);
    if (!channel) {
      return { status: "channel_missing", channelId: subscription.channelId };
    }

    try {
      const embed = await this.buildDigestEmbed(subscription);
      const { mention, allowedMentions } = buildRoleMentionOptions(subscription.roleId);
      await channel.send({
        content: mention,
        allowedMentions,
        embeds: [embed],
      });
      await this.updateLastSent(subscription.guildId);
      logInfo("Weekly digest sent (manual).", {
        guildId: subscription.guildId,
        channelId: subscription.channelId,
      });
      return { status: "sent", channelId: subscription.channelId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logWarn("Manual weekly digest failed.", {
        guildId: subscription.guildId,
        channelId: subscription.channelId,
        error: message,
      });
      return { status: "error", message };
    }
  }

  async runTick(client: Client): Promise<void> {
    if (this.isTicking) {
      return;
    }
    this.isTicking = true;
    const now = new Date();
    this.lastTickAt = now.toISOString();
    try {
      const subscriptions = await this.listSubscriptions();
      if (subscriptions.length === 0) {
        return;
      }
      for (const subscription of subscriptions) {
        const scheduleMs = Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          subscription.hourUtc,
          subscription.minuteUtc,
          0,
          0
        );
        const scheduleDay = getLocalDayForUtcMs(scheduleMs, subscription.utcOffsetMinutes);
        if (scheduleDay !== subscription.dayOfWeek) {
          continue;
        }
        if (now.getTime() < scheduleMs) {
          continue;
        }
        const weekStart = getLocalWeekStartUtcMs(
          now,
          subscription.utcOffsetMinutes,
          subscription.dayOfWeek
        );
        const lastSentAt = subscription.lastSentAt ? Date.parse(subscription.lastSentAt) : 0;
        if (Number.isFinite(lastSentAt) && lastSentAt >= weekStart) {
          continue;
        }

        const channel = await resolveSendableChannel(client, subscription.channelId);
        if (!channel) {
          logWarn("Weekly digest channel missing.", {
            guildId: subscription.guildId,
            channelId: subscription.channelId,
          });
          continue;
        }

        const embed = await this.buildDigestEmbed(subscription);
        const { mention, allowedMentions } = buildRoleMentionOptions(subscription.roleId);
        await channel.send({
          content: mention,
          allowedMentions,
          embeds: [embed],
        });
        await this.updateLastSent(subscription.guildId);
        logInfo("Weekly digest sent.", {
          guildId: subscription.guildId,
          channelId: subscription.channelId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError(`Weekly digest tick failed: ${message}`);
    } finally {
      this.isTicking = false;
    }
  }

  private async updateLastSent(guildId: string): Promise<void> {
    await this.db
      .updateTable("weekly_digests")
      .set({ last_sent_at: new Date().toISOString() })
      .where("guild_id", "=", guildId)
      .execute();
  }

  private async buildDigestEmbed(subscription: WeeklyDigestSubscription): Promise<EmbedBuilder> {
    const lookbackDays = DEFAULT_LOOKBACK_DAYS;
    const sinceIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const [challengeActivity, contestActivity] = await Promise.all([
      this.store.getChallengeActivity(subscription.guildId, sinceIso, 5),
      this.contestActivity.getGuildContestActivity(subscription.guildId, {
        lookbackDays,
        recentLimit: DEFAULT_RECENT_CONTESTS,
        participantLimit: DEFAULT_PARTICIPANT_LIMIT,
      }),
    ]);
    const ratingSummary = await this.contestActivity.getGuildRatingChangeSummary(
      subscription.guildId,
      {
        lookbackDays,
        limit: DEFAULT_RATING_DELTA_LIMIT,
      }
    );

    const baseDescription = `Highlights from the last ${lookbackDays} days.`;
    const embed = new EmbedBuilder().setTitle("Weekly digest").setColor(EMBED_COLORS.info);

    const challengeLines = [
      `Completed challenges: ${challengeActivity.completedChallenges}`,
      `Participants: ${challengeActivity.participantCount} (${challengeActivity.uniqueParticipants} unique)`,
      `Solves: ${challengeActivity.solvedCount}`,
    ];
    if (challengeActivity.topSolvers.length > 0) {
      const topSolvers = challengeActivity.topSolvers
        .slice(0, 3)
        .map((entry, index) => formatUserLine(entry.userId, entry.solvedCount, `${index + 1}.`))
        .join("\n");
      challengeLines.push(`Top solvers:\n${topSolvers}`);
    } else {
      challengeLines.push("Top solvers: none yet");
    }
    embed.addFields({
      name: "Challenge activity",
      value: challengeLines.join("\n"),
      inline: false,
    });

    const contestSummaryLines = [
      `Contests: ${contestActivity.contestCount}`,
      `Participants: ${contestActivity.participantCount}`,
      `Official: ${contestActivity.byScope.official.contestCount} contests, ${contestActivity.byScope.official.participantCount} participants`,
      `Gym: ${contestActivity.byScope.gym.contestCount} contests, ${contestActivity.byScope.gym.participantCount} participants`,
    ];
    embed.addFields({
      name: "Contest activity",
      value: contestSummaryLines.join("\n"),
      inline: false,
    });

    const ratingLines = [
      `Rated contests: ${ratingSummary.contestCount}`,
      `Participants: ${ratingSummary.participantCount}`,
      `Net delta: ${formatDelta(ratingSummary.totalDelta)}`,
    ];
    if (ratingSummary.topGainers.length > 0) {
      const lines = ratingSummary.topGainers
        .map(
          (entry, index) =>
            `${index + 1}. <@${entry.userId}> (${entry.handle}) • ${formatDelta(entry.delta)}`
        )
        .join("\n");
      ratingLines.push(`Top gainers:\n${lines}`);
    } else {
      ratingLines.push("Top gainers: none yet");
    }
    if (ratingSummary.topLosers.length > 0) {
      const lines = ratingSummary.topLosers
        .map(
          (entry, index) =>
            `${index + 1}. <@${entry.userId}> (${entry.handle}) • ${formatDelta(entry.delta)}`
        )
        .join("\n");
      ratingLines.push(`Top losses:\n${lines}`);
    } else {
      ratingLines.push("Top losses: none yet");
    }
    embed.addFields({
      name: "Rating changes",
      value: ratingLines.join("\n"),
      inline: false,
    });

    if (contestActivity.recentContests.length > 0) {
      const recentLines = contestActivity.recentContests
        .map((contest) => {
          const scopeLabel = contest.scope === "gym" ? " [Gym]" : "";
          return `- ${contest.contestName}${scopeLabel} (${formatDiscordRelativeTime(
            contest.ratingUpdateTimeSeconds
          )})`;
        })
        .join("\n");
      embed.addFields({ name: "Recent contests", value: recentLines, inline: false });
    } else {
      embed.addFields({
        name: "Recent contests",
        value: "No contest activity recorded.",
        inline: false,
      });
    }

    if (contestActivity.participants.length > 0) {
      const participantLines = contestActivity.participants
        .slice(0, DEFAULT_PARTICIPANT_LIMIT)
        .map(
          (participant, index) =>
            `${index + 1}. <@${participant.userId}> (${participant.handle}) • ${
              participant.contestCount
            }`
        )
        .join("\n");
      embed.addFields({
        name: "Top contest participants",
        value: participantLines,
        inline: false,
      });
    } else {
      embed.addFields({
        name: "Top contest participants",
        value: "No contest participation recorded.",
        inline: false,
      });
    }

    const nextScheduledAt = getNextWeeklyScheduledUtcMs(
      new Date(),
      subscription.dayOfWeek,
      subscription.hourUtc,
      subscription.minuteUtc,
      subscription.utcOffsetMinutes
    );
    embed.setDescription(
      `${baseDescription}\nNext digest: ${formatDiscordTimestamp(
        Math.floor(nextScheduledAt / 1000)
      )}`
    );
    return embed;
  }
}

export const weeklyDigestIntervalMs = 5 * 60 * 1000;
