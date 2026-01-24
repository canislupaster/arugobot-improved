import { ChannelType, EmbedBuilder, type Client } from "discord.js";
import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import {
  filterProblemsByRatingRanges,
  filterProblemsByTags,
  getProblemId,
  parseTagFilters,
  selectRandomProblem,
} from "../utils/problemSelection.js";
import type { RatingRange } from "../utils/ratingRanges.js";

import type { Problem, ProblemService } from "./problems.js";
import type { StoreService } from "./store.js";

const DEFAULT_RATING_RANGES: RatingRange[] = [{ min: 800, max: 3500 }];
const MAX_HANDLES_FOR_SOLVED = 10;
const POST_RETENTION_DAYS = 120;

export type PracticeReminder = {
  guildId: string;
  channelId: string;
  hourUtc: number;
  minuteUtc: number;
  utcOffsetMinutes: number;
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
  | { status: "no_problem"; candidateCount: number }
  | { status: "error"; message: string };

type PracticeSelectionResult = {
  problem: Problem | null;
  skippedHandles: number;
  staleHandles: number;
  candidateCount: number;
};

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

function getTodayStartUtcMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
}

export function getNextScheduledUtcMs(now: Date, hourUtc: number, minuteUtc: number): number {
  const todayScheduled = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hourUtc,
    minuteUtc,
    0,
    0
  );
  if (now.getTime() <= todayScheduled) {
    return todayScheduled;
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

function buildRoleMention(roleId: string | null): string | undefined {
  return roleId ? `<@&${roleId}>` : undefined;
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
      .select([
        "guild_id",
        "channel_id",
        "hour_utc",
        "minute_utc",
        "utc_offset_minutes",
        "rating_ranges",
        "tags",
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
      hourUtc: row.hour_utc,
      minuteUtc: row.minute_utc,
      utcOffsetMinutes: row.utc_offset_minutes ?? 0,
      ratingRanges: parseRatingRanges(row.rating_ranges),
      tags: row.tags ?? "",
      roleId: row.role_id ?? null,
      lastSentAt: row.last_sent_at ?? null,
    };
  }

  async listSubscriptions(): Promise<PracticeReminder[]> {
    const rows = await this.db
      .selectFrom("practice_reminders")
      .select([
        "guild_id",
        "channel_id",
        "hour_utc",
        "minute_utc",
        "utc_offset_minutes",
        "rating_ranges",
        "tags",
        "role_id",
        "last_sent_at",
      ])
      .execute();
    return rows.map((row) => ({
      guildId: row.guild_id,
      channelId: row.channel_id,
      hourUtc: row.hour_utc,
      minuteUtc: row.minute_utc,
      utcOffsetMinutes: row.utc_offset_minutes ?? 0,
      ratingRanges: parseRatingRanges(row.rating_ranges),
      tags: row.tags ?? "",
      roleId: row.role_id ?? null,
      lastSentAt: row.last_sent_at ?? null,
    }));
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
    ratingRanges: RatingRange[],
    tags: string,
    roleId: string | null
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.db
      .insertInto("practice_reminders")
      .values({
        guild_id: guildId,
        channel_id: channelId,
        hour_utc: hourUtc,
        minute_utc: minuteUtc,
        utc_offset_minutes: utcOffsetMinutes,
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
      subscription.minuteUtc
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
    const todayStart = getTodayStartUtcMs(now);
    const lastSentAt = subscription.lastSentAt ? Date.parse(subscription.lastSentAt) : 0;
    if (!force && Number.isFinite(lastSentAt) && lastSentAt >= todayStart) {
      return {
        status: "already_sent",
        lastSentAt: subscription.lastSentAt ?? new Date().toISOString(),
      };
    }

    const channel = await client.channels.fetch(subscription.channelId).catch(() => null);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      return { status: "channel_missing", channelId: subscription.channelId };
    }

    try {
      await this.cleanupPosts();
      const selection = await this.selectProblem(subscription);
      if (!selection.problem) {
        return { status: "no_problem", candidateCount: selection.candidateCount };
      }

      const embed = this.buildPracticeEmbed(subscription, selection.problem, selection);
      const mention = buildRoleMention(subscription.roleId);
      await channel.send({
        content: mention,
        allowedMentions: mention ? { roles: [subscription.roleId!] } : { parse: [] },
        embeds: [embed],
      });
      await this.markPosted(subscription.guildId, selection.problem);
      await this.updateLastSent(subscription.guildId);
      const problemId = getProblemId(selection.problem);
      logInfo("Practice reminder sent (manual).", {
        guildId: subscription.guildId,
        channelId: subscription.channelId,
        problemId,
      });
      return { status: "sent", problemId, channelId: subscription.channelId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logWarn("Manual practice reminder failed.", {
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
    this.lastTickAt = new Date().toISOString();

    try {
      const subscriptions = await this.listSubscriptions();
      if (subscriptions.length === 0) {
        return;
      }

      try {
        await this.cleanupPosts();
      } catch (error) {
        logWarn("Practice reminder cleanup failed.", { error: String(error) });
      }

      const problems = await this.problems.ensureProblemsLoaded();
      if (problems.length === 0) {
        logWarn("Practice reminders skipped: problem cache empty.");
        return;
      }

      const now = new Date();
      const todayStart = getTodayStartUtcMs(now);

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
        if (now.getTime() < scheduleMs) {
          continue;
        }
        const lastSentAt = subscription.lastSentAt ? Date.parse(subscription.lastSentAt) : 0;
        if (Number.isFinite(lastSentAt) && lastSentAt >= todayStart) {
          continue;
        }

        const channel = await client.channels.fetch(subscription.channelId).catch(() => null);
        if (
          !channel ||
          (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
        ) {
          logWarn("Practice reminder channel missing or invalid.", {
            guildId: subscription.guildId,
            channelId: subscription.channelId,
          });
          continue;
        }

        const selection = await this.selectProblem(subscription);
        if (!selection.problem) {
          logWarn("Practice reminder skipped: no suitable problem.", {
            guildId: subscription.guildId,
            candidateCount: selection.candidateCount,
          });
          continue;
        }

        const embed = this.buildPracticeEmbed(subscription, selection.problem, selection);
        try {
          const mention = buildRoleMention(subscription.roleId);
          await channel.send({
            content: mention,
            allowedMentions: mention ? { roles: [subscription.roleId!] } : { parse: [] },
            embeds: [embed],
          });
          await this.markPosted(subscription.guildId, selection.problem);
          await this.updateLastSent(subscription.guildId);
          logInfo("Practice reminder sent.", {
            guildId: subscription.guildId,
            channelId: subscription.channelId,
            problemId: getProblemId(selection.problem),
          });
        } catch (error) {
          logWarn("Practice reminder send failed.", {
            guildId: subscription.guildId,
            channelId: subscription.channelId,
            error: String(error),
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

  private buildPracticeEmbed(
    subscription: PracticeReminder,
    problem: Problem,
    selection: PracticeSelectionResult
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle("Daily practice problem")
      .setColor(0x2ecc71)
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
