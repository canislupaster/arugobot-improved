import { EmbedBuilder, type Client } from "discord.js";
import type { Kysely } from "kysely";

import type { Database, PracticeRemindersTable } from "../db/types.js";
import {
  buildChannelServiceError,
  getSendableChannelStatusOrWarn,
  type SendableChannel,
} from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { buildServiceErrorFromException } from "../utils/errors.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import { buildRoleMentionOptions } from "../utils/mentions.js";
import {
  filterProblemsByRatingRanges,
  filterProblemsByTags,
  getProblemId,
  parseTagFilters,
  selectRandomProblem,
} from "../utils/problemSelection.js";
import type { RatingRange } from "../utils/ratingRanges.js";
import {
  getManualSendFailure,
  recordReminderSendFailure,
  resolveManualSendChannel,
} from "../utils/reminders.js";
import { getLocalDayForUtcMs, getUtcScheduleMs, wasSentSince } from "../utils/time.js";

import type { Problem, ProblemService } from "./problems.js";
import type { StoreService } from "./store.js";

const DEFAULT_RATING_RANGES: RatingRange[] = [{ min: 800, max: 3500 }];
const MAX_HANDLES_FOR_SOLVED = 10;
const POST_RETENTION_DAYS = 120;
const DEFAULT_DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6];
const PRACTICE_REMINDER_COLUMNS = [
  "guild_id",
  "channel_id",
  "hour_utc",
  "minute_utc",
  "utc_offset_minutes",
  "days_of_week",
  "rating_ranges",
  "tags",
  "role_id",
  "last_sent_at",
] as const;

export type PracticeReminder = {
  guildId: string;
  channelId: string;
  hourUtc: number;
  minuteUtc: number;
  utcOffsetMinutes: number;
  daysOfWeek: number[];
  ratingRanges: RatingRange[];
  tags: string;
  roleId: string | null;
  lastSentAt: string | null;
};

export type PracticeReminderPost = {
  problemId: string;
  sentAt: string;
};

export type PracticeReminderPreview = {
  subscription: PracticeReminder;
  nextScheduledAt: number;
  problem: Problem | null;
  skippedHandles: number;
  staleHandles: number;
  candidateCount: number;
};

export type ManualReminderResult =
  | { status: "sent"; problemId: string; channelId: string }
  | { status: "no_subscription" }
  | { status: "already_sent"; lastSentAt: string }
  | { status: "channel_missing"; channelId: string }
  | { status: "channel_missing_permissions"; channelId: string; missingPermissions: string[] }
  | { status: "no_problem"; candidateCount: number }
  | { status: "error"; message: string };

type PracticeSelectionResult = {
  problem: Problem | null;
  skippedHandles: number;
  staleHandles: number;
  candidateCount: number;
};

type PracticeReminderRow = Pick<
  PracticeRemindersTable,
  | "guild_id"
  | "channel_id"
  | "hour_utc"
  | "minute_utc"
  | "utc_offset_minutes"
  | "days_of_week"
  | "rating_ranges"
  | "tags"
  | "role_id"
  | "last_sent_at"
>;

function parseRatingRanges(raw: string | null | undefined): RatingRange[] {
  if (!raw) {
    return DEFAULT_RATING_RANGES.slice();
  }
  try {
    const parsed = JSON.parse(raw) as RatingRange[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_RATING_RANGES.slice();
    }
    const sanitized = parsed.filter(
      (range) => Number.isFinite(range.min) && Number.isFinite(range.max) && range.min <= range.max
    );
    return sanitized.length > 0 ? sanitized : DEFAULT_RATING_RANGES.slice();
  } catch {
    return DEFAULT_RATING_RANGES.slice();
  }
}

function normalizeDaysOfWeek(days: number[]): number[] {
  const normalized = new Set<number>();
  for (const day of days) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      normalized.add(day);
    }
  }
  const sorted = Array.from(normalized.values()).sort((a, b) => a - b);
  return sorted.length > 0 ? sorted : DEFAULT_DAYS_OF_WEEK.slice();
}

function parseDaysOfWeek(raw: string | null | undefined): number[] {
  if (!raw) {
    return DEFAULT_DAYS_OF_WEEK.slice();
  }
  try {
    const parsed = JSON.parse(raw) as number[];
    if (!Array.isArray(parsed)) {
      return DEFAULT_DAYS_OF_WEEK.slice();
    }
    return normalizeDaysOfWeek(parsed);
  } catch {
    return DEFAULT_DAYS_OF_WEEK.slice();
  }
}

function mapPracticeReminderRow(row: PracticeReminderRow): PracticeReminder {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    hourUtc: row.hour_utc,
    minuteUtc: row.minute_utc,
    utcOffsetMinutes: row.utc_offset_minutes ?? 0,
    daysOfWeek: parseDaysOfWeek(row.days_of_week),
    ratingRanges: parseRatingRanges(row.rating_ranges),
    tags: row.tags ?? "",
    roleId: row.role_id ?? null,
    lastSentAt: row.last_sent_at ?? null,
  };
}

function getLocalDayStartUtcMs(now: Date, offsetMinutes: number): number {
  const adjusted = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  const localStart = Date.UTC(
    adjusted.getUTCFullYear(),
    adjusted.getUTCMonth(),
    adjusted.getUTCDate(),
    0,
    0,
    0,
    0
  );
  return localStart - offsetMinutes * 60 * 1000;
}

export function getNextScheduledUtcMs(
  now: Date,
  hourUtc: number,
  minuteUtc: number,
  daysOfWeek: number[] = DEFAULT_DAYS_OF_WEEK,
  utcOffsetMinutes = 0
): number {
  const normalizedDays = normalizeDaysOfWeek(daysOfWeek);
  const nowMs = now.getTime();
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + offset,
      hourUtc,
      minuteUtc,
      0,
      0
    );
    if (candidate < nowMs) {
      continue;
    }
    const localDay = getLocalDayForUtcMs(candidate, utcOffsetMinutes);
    if (normalizedDays.includes(localDay)) {
      return candidate;
    }
  }
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    hourUtc,
    minuteUtc,
    0,
    0
  );
}

function formatProblemLink(problem: Problem): string {
  return `[${problem.index}. ${problem.name}](https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index})`;
}

function formatRatingRanges(ranges: RatingRange[]): string {
  return ranges
    .map((range) => (range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`))
    .join(", ");
}

export class PracticeReminderService {
  private lastTickAt: string | null = null;
  private lastError: { message: string; timestamp: string } | null = null;
  private isTicking = false;

  constructor(
    private db: Kysely<Database>,
    private problems: ProblemService,
    private store: StoreService
  ) {}

  getLastTickAt(): string | null {
    return this.lastTickAt;
  }

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async getSubscription(guildId: string): Promise<PracticeReminder | null> {
    const row = await this.db
      .selectFrom("practice_reminders")
      .select(PRACTICE_REMINDER_COLUMNS)
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    return mapPracticeReminderRow(row);
  }

  async listSubscriptions(): Promise<PracticeReminder[]> {
    const rows = await this.db
      .selectFrom("practice_reminders")
      .select(PRACTICE_REMINDER_COLUMNS)
      .execute();
    return rows.map(mapPracticeReminderRow);
  }

  async getSubscriptionCount(): Promise<number> {
    const row = await this.db
      .selectFrom("practice_reminders")
      .select(({ fn }) => fn.count<number>("guild_id").as("count"))
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  async getRecentPosts(guildId: string, limit: number): Promise<PracticeReminderPost[]> {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
    const rows = await this.db
      .selectFrom("practice_posts")
      .select(["problem_id", "sent_at"])
      .where("guild_id", "=", guildId)
      .orderBy("sent_at", "desc")
      .limit(safeLimit)
      .execute();
    return rows.map((row) => ({
      problemId: row.problem_id,
      sentAt: row.sent_at,
    }));
  }

  async setSubscription(
    guildId: string,
    channelId: string,
    hourUtc: number,
    minuteUtc: number,
    utcOffsetMinutes: number,
    daysOfWeek: number[],
    ratingRanges: RatingRange[],
    tags: string,
    roleId: string | null
  ): Promise<void> {
    const normalizedDays = normalizeDaysOfWeek(daysOfWeek);
    const timestamp = new Date().toISOString();
    await this.db
      .insertInto("practice_reminders")
      .values({
        guild_id: guildId,
        channel_id: channelId,
        hour_utc: hourUtc,
        minute_utc: minuteUtc,
        utc_offset_minutes: utcOffsetMinutes,
        days_of_week: JSON.stringify(normalizedDays),
        rating_ranges: JSON.stringify(ratingRanges),
        tags,
        role_id: roleId,
        last_sent_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict((oc) =>
        oc.column("guild_id").doUpdateSet({
          channel_id: channelId,
          hour_utc: hourUtc,
          minute_utc: minuteUtc,
          utc_offset_minutes: utcOffsetMinutes,
          days_of_week: JSON.stringify(normalizedDays),
          rating_ranges: JSON.stringify(ratingRanges),
          tags,
          role_id: roleId,
          updated_at: timestamp,
        })
      )
      .execute();
  }

  async clearSubscription(guildId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("practice_reminders")
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0) > 0;
  }

  async getPreview(guildId: string): Promise<PracticeReminderPreview | null> {
    const subscription = await this.getSubscription(guildId);
    if (!subscription) {
      return null;
    }
    const selection = await this.selectProblem(subscription);
    const nextScheduledAt = getNextScheduledUtcMs(
      new Date(),
      subscription.hourUtc,
      subscription.minuteUtc,
      subscription.daysOfWeek,
      subscription.utcOffsetMinutes
    );
    return {
      subscription,
      nextScheduledAt,
      problem: selection.problem,
      skippedHandles: selection.skippedHandles,
      staleHandles: selection.staleHandles,
      candidateCount: selection.candidateCount,
    };
  }

  async sendManualReminder(
    guildId: string,
    client: Client,
    force = false
  ): Promise<ManualReminderResult> {
    const subscription = await this.getSubscription(guildId);
    if (!subscription) {
      return { status: "no_subscription" };
    }

    const now = new Date();
    const todayStart = getLocalDayStartUtcMs(now, subscription.utcOffsetMinutes);
    const manualCheck = await resolveManualSendChannel(client, {
      channelId: subscription.channelId,
      lastSentAt: subscription.lastSentAt,
      force,
      periodStartMs: todayStart,
    });
    if (manualCheck.status !== "ready") {
      return getManualSendFailure(manualCheck);
    }
    const channel = manualCheck.channel;

    try {
      await this.cleanupPosts();
      const selection = await this.selectProblem(subscription);
      if (!selection.problem) {
        return { status: "no_problem", candidateCount: selection.candidateCount };
      }

      const problemId = await this.sendReminderMessage(subscription, selection, channel, "manual");
      return { status: "sent", problemId, channelId: subscription.channelId };
    } catch (error) {
      const message = recordReminderSendFailure({
        error,
        record: (entry) => {
          this.lastError = entry;
        },
        log: logWarn,
        logMessage: "Manual practice reminder failed.",
        logContext: {
          guildId: subscription.guildId,
          channelId: subscription.channelId,
        },
      });
      return { status: "error", message };
    }
  }

  async runTick(client: Client): Promise<void> {
    if (this.isTicking) {
      return;
    }
    this.isTicking = true;
    this.lastTickAt = new Date().toISOString();

    try {
      const subscriptions = await this.listSubscriptions();
      if (subscriptions.length === 0) {
        return;
      }

      try {
        await this.cleanupPosts();
      } catch (error) {
        logWarn("Practice reminder cleanup failed.", {
          error: buildServiceErrorFromException(error).message,
        });
      }

      const problems = await this.problems.ensureProblemsLoaded();
      if (problems.length === 0) {
        logWarn("Practice reminders skipped: problem cache empty.");
        return;
      }

      const now = new Date();

      for (const subscription of subscriptions) {
        const todayStart = getLocalDayStartUtcMs(now, subscription.utcOffsetMinutes);
        const scheduleMs = getUtcScheduleMs(now, subscription.hourUtc, subscription.minuteUtc);
        const scheduleDay = getLocalDayForUtcMs(scheduleMs, subscription.utcOffsetMinutes);
        if (!subscription.daysOfWeek.includes(scheduleDay)) {
          continue;
        }
        if (now.getTime() < scheduleMs) {
          continue;
        }
        if (wasSentSince(subscription.lastSentAt, todayStart)) {
          continue;
        }

        const channelStatus = await getSendableChannelStatusOrWarn(
          client,
          subscription.channelId,
          "Practice reminder channel missing or invalid.",
          { guildId: subscription.guildId }
        );
        if (channelStatus.status !== "ok") {
          this.lastError =
            buildChannelServiceError(
              "Practice reminder",
              subscription.channelId,
              channelStatus
            ) ?? this.lastError;
          continue;
        }
        const channel = channelStatus.channel;

        const selection = await this.selectProblem(subscription);
        if (!selection.problem) {
          logWarn("Practice reminder skipped: no suitable problem.", {
            guildId: subscription.guildId,
            candidateCount: selection.candidateCount,
          });
          continue;
        }

        try {
          await this.sendReminderMessage(subscription, selection, channel, "scheduled");
        } catch (error) {
          recordReminderSendFailure({
            error,
            record: (entry) => {
              this.lastError = entry;
            },
            log: logWarn,
            logMessage: "Practice reminder send failed.",
            logContext: {
              guildId: subscription.guildId,
              channelId: subscription.channelId,
              problemId: selection.problem ? getProblemId(selection.problem) : undefined,
            },
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError("Practice reminder tick failed.", { error: message });
    } finally {
      this.isTicking = false;
    }
  }

  private async selectProblem(subscription: PracticeReminder): Promise<PracticeSelectionResult> {
    const problems = await this.problems.ensureProblemsLoaded();
    if (problems.length === 0) {
      return { problem: null, skippedHandles: 0, staleHandles: 0, candidateCount: 0 };
    }

    const tagFilters = parseTagFilters(subscription.tags);
    const rated = filterProblemsByRatingRanges(problems, subscription.ratingRanges);
    const candidates = filterProblemsByTags(rated, tagFilters);

    const { excludedIds, skippedHandles, staleHandles } = await this.getExcludedIds(
      subscription.guildId
    );
    const problem = selectRandomProblem(candidates, excludedIds);
    return {
      problem,
      skippedHandles,
      staleHandles,
      candidateCount: candidates.length,
    };
  }

  private async getExcludedIds(
    guildId: string
  ): Promise<{ excludedIds: Set<string>; skippedHandles: number; staleHandles: number }> {
    const excludedIds = new Set<string>();

    const posted = await this.db
      .selectFrom("practice_posts")
      .select("problem_id")
      .where("guild_id", "=", guildId)
      .execute();
    for (const row of posted) {
      excludedIds.add(row.problem_id);
    }

    const linkedUsers = await this.store.getLinkedUsers(guildId);
    for (const user of linkedUsers) {
      const history = await this.store.getHistoryList(guildId, user.userId);
      for (const problemId of history) {
        excludedIds.add(problemId);
      }
    }

    const handles = linkedUsers.map((user) => user.handle);
    const limited = handles.slice(0, MAX_HANDLES_FOR_SOLVED);
    const skippedHandles = Math.max(0, handles.length - limited.length);
    let staleHandles = 0;

    for (const handle of limited) {
      const solved = await this.store.getSolvedProblems(handle);
      if (!solved) {
        staleHandles += 1;
        continue;
      }
      for (const problemId of solved) {
        excludedIds.add(problemId);
      }
    }

    return { excludedIds, skippedHandles, staleHandles };
  }

  private async cleanupPosts(): Promise<void> {
    const cutoffIso = new Date(
      Date.now() - POST_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    await this.db.deleteFrom("practice_posts").where("sent_at", "<", cutoffIso).execute();
  }

  private async updateLastSent(guildId: string): Promise<void> {
    await this.db
      .updateTable("practice_reminders")
      .set({ last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .where("guild_id", "=", guildId)
      .execute();
  }

  private async markPosted(guildId: string, problem: Problem): Promise<void> {
    await this.db
      .insertInto("practice_posts")
      .values({
        guild_id: guildId,
        problem_id: getProblemId(problem),
        sent_at: new Date().toISOString(),
      })
      .onConflict((oc) => oc.columns(["guild_id", "problem_id"]).doNothing())
      .execute();
  }

  private async sendReminderMessage(
    subscription: PracticeReminder,
    selection: PracticeSelectionResult,
    channel: SendableChannel,
    source: "manual" | "scheduled"
  ): Promise<string> {
    if (!selection.problem) {
      throw new Error("No practice problem selected.");
    }
    const embed = this.buildPracticeEmbed(subscription, selection.problem, selection);
    const { mention, allowedMentions } = buildRoleMentionOptions(subscription.roleId);
    await channel.send({
      content: mention,
      allowedMentions,
      embeds: [embed],
    });
    await this.markPosted(subscription.guildId, selection.problem);
    await this.updateLastSent(subscription.guildId);
    const problemId = getProblemId(selection.problem);
    logInfo(source === "manual" ? "Practice reminder sent (manual)." : "Practice reminder sent.", {
      guildId: subscription.guildId,
      channelId: subscription.channelId,
      problemId,
    });
    return problemId;
  }

  private buildPracticeEmbed(
    subscription: PracticeReminder,
    problem: Problem,
    selection: PracticeSelectionResult
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle("Daily practice problem")
      .setColor(EMBED_COLORS.success)
      .addFields(
        { name: "Problem", value: formatProblemLink(problem), inline: false },
        { name: "Rating", value: String(problem.rating ?? "N/A"), inline: true },
        {
          name: "Tags",
          value: problem.tags.length > 0 ? problem.tags.join(", ") : "None",
          inline: false,
        }
      );

    const rangeLabel = formatRatingRanges(subscription.ratingRanges);
    const filterLabel = subscription.tags.trim() ? subscription.tags.trim() : "None";
    embed.setFooter({ text: `Ranges: ${rangeLabel} • Tags: ${filterLabel}` });

    if (selection.skippedHandles > 0 || selection.staleHandles > 0) {
      const notes = [];
      if (selection.skippedHandles > 0) {
        notes.push(`${selection.skippedHandles} handle(s) skipped`);
      }
      if (selection.staleHandles > 0) {
        notes.push(`${selection.staleHandles} handle(s) used cached solves`);
      }
      embed.addFields({ name: "Notes", value: notes.join(" • "), inline: false });
    }

    return embed;
  }
}

export const practiceReminderIntervalMs = 5 * 60 * 1000;
