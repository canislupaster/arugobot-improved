import { ChannelType, EmbedBuilder, type Client } from "discord.js";
import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import {
  filterContestsByKeywords,
  parseKeywordFilters,
  serializeKeywords,
} from "../utils/contestFilters.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatDuration,
} from "../utils/time.js";

import type { Contest, ContestService } from "./contests.js";

const NOTIFICATION_RETENTION_DAYS = 14;

export type ContestReminder = {
  guildId: string;
  channelId: string;
  minutesBefore: number;
  roleId: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
};

export type ManualContestReminderResult =
  | { status: "no_subscription" }
  | { status: "channel_missing"; channelId: string }
  | { status: "no_contest" }
  | { status: "already_notified"; contestId: number; contestName: string; notifiedAt: string }
  | {
      status: "sent";
      contestId: number;
      contestName: string;
      channelId: string;
      minutesBefore: number;
      isStale: boolean;
    }
  | { status: "error"; message: string };

type ContestProvider = Pick<ContestService, "refresh" | "getUpcomingContests">;

export class ContestReminderService {
  private lastTickAt: string | null = null;
  private lastError: { message: string; timestamp: string } | null = null;
  private isTicking = false;

  constructor(
    private db: Kysely<Database>,
    private contests: ContestProvider
  ) {}

  getLastTickAt(): string | null {
    return this.lastTickAt;
  }

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async getSubscription(guildId: string): Promise<ContestReminder | null> {
    const row = await this.db
      .selectFrom("contest_reminders")
      .select([
        "guild_id",
        "channel_id",
        "minutes_before",
        "role_id",
        "include_keywords",
        "exclude_keywords",
      ])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    const filters = parseKeywordFilters(row.include_keywords, row.exclude_keywords);
    return {
      guildId: row.guild_id,
      channelId: row.channel_id,
      minutesBefore: row.minutes_before,
      roleId: row.role_id ?? null,
      includeKeywords: filters.includeKeywords,
      excludeKeywords: filters.excludeKeywords,
    };
  }

  async listSubscriptions(): Promise<ContestReminder[]> {
    const rows = await this.db
      .selectFrom("contest_reminders")
      .select([
        "guild_id",
        "channel_id",
        "minutes_before",
        "role_id",
        "include_keywords",
        "exclude_keywords",
      ])
      .execute();
    return rows.map((row) => ({
      guildId: row.guild_id,
      channelId: row.channel_id,
      minutesBefore: row.minutes_before,
      roleId: row.role_id ?? null,
      ...parseKeywordFilters(row.include_keywords, row.exclude_keywords),
    }));
  }

  async getSubscriptionCount(): Promise<number> {
    const row = await this.db
      .selectFrom("contest_reminders")
      .select(({ fn }) => fn.count<number>("guild_id").as("count"))
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  async setSubscription(
    guildId: string,
    channelId: string,
    minutesBefore: number,
    roleId: string | null,
    includeKeywords: string[],
    excludeKeywords: string[]
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.db
      .insertInto("contest_reminders")
      .values({
        guild_id: guildId,
        channel_id: channelId,
        minutes_before: minutesBefore,
        role_id: roleId,
        include_keywords: serializeKeywords(includeKeywords),
        exclude_keywords: serializeKeywords(excludeKeywords),
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict((oc) =>
        oc.column("guild_id").doUpdateSet({
          channel_id: channelId,
          minutes_before: minutesBefore,
          role_id: roleId,
          include_keywords: serializeKeywords(includeKeywords),
          exclude_keywords: serializeKeywords(excludeKeywords),
          updated_at: timestamp,
        })
      )
      .execute();
  }

  async clearSubscription(guildId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("contest_reminders")
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0) > 0;
  }

  async sendManualReminder(
    guildId: string,
    client: Client,
    force = false
  ): Promise<ManualContestReminderResult> {
    const subscription = await this.getSubscription(guildId);
    if (!subscription) {
      return { status: "no_subscription" };
    }

    const channel = await client.channels.fetch(subscription.channelId).catch(() => null);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      return { status: "channel_missing", channelId: subscription.channelId };
    }

    let isStale = false;
    try {
      await this.contests.refresh();
    } catch (error) {
      isStale = true;
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logWarn("Contest reminder refresh failed; using cached contests.", { error: message });
    }

    const upcoming = this.contests.getUpcomingContests();
    const filtered = filterContestsByKeywords(upcoming, {
      includeKeywords: subscription.includeKeywords,
      excludeKeywords: subscription.excludeKeywords,
    });

    if (filtered.length === 0) {
      return { status: "no_contest" };
    }

    const contest = filtered[0]!;
    if (!force) {
      const notification = await this.getNotification(subscription.guildId, contest.id);
      if (notification) {
        return {
          status: "already_notified",
          contestId: contest.id,
          contestName: contest.name,
          notifiedAt: notification.notified_at,
        };
      }
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const secondsUntil = Math.max(0, contest.startTimeSeconds - nowSeconds);
    const embed = buildReminderEmbed(contest, secondsUntil);
    try {
      const mention = subscription.roleId ? `<@&${subscription.roleId}>` : undefined;
      await channel.send({
        content: mention,
        allowedMentions: mention ? { roles: [subscription.roleId!] } : { parse: [] },
        embeds: [embed],
      });
      await this.markNotified(subscription.guildId, contest.id);
      logInfo("Contest reminder sent (manual).", {
        guildId: subscription.guildId,
        channelId: subscription.channelId,
        contestId: contest.id,
        minutesBefore: subscription.minutesBefore,
        isStale,
      });
      return {
        status: "sent",
        contestId: contest.id,
        contestName: contest.name,
        channelId: subscription.channelId,
        minutesBefore: subscription.minutesBefore,
        isStale,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logWarn("Contest reminder send failed (manual).", {
        guildId: subscription.guildId,
        channelId: subscription.channelId,
        contestId: contest.id,
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
      let subscriptions: ContestReminder[] = [];
      try {
        subscriptions = await this.listSubscriptions();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = { message, timestamp: new Date().toISOString() };
        logError("Contest reminder subscription load failed.", { error: message });
        return;
      }

      if (subscriptions.length === 0) {
        return;
      }

      let refreshFailed = false;
      try {
        await this.contests.refresh();
      } catch (error) {
        refreshFailed = true;
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = { message, timestamp: new Date().toISOString() };
        logWarn("Contest reminder refresh failed; using cached contests.", { error: message });
      }

      const upcoming = this.contests.getUpcomingContests();
      if (upcoming.length === 0) {
        if (refreshFailed) {
          logWarn("Contest reminders skipped: no cached contests available.");
        }
        return;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const cutoff = new Date(
        Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      try {
        await this.cleanupNotifications(cutoff);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWarn("Contest reminder cleanup failed.", { error: message });
      }

      for (const subscription of subscriptions) {
        const channel = await client.channels.fetch(subscription.channelId).catch(() => null);
        if (
          !channel ||
          (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
        ) {
          logWarn("Contest reminder channel missing or invalid.", {
            guildId: subscription.guildId,
            channelId: subscription.channelId,
          });
          continue;
        }

        const textChannel = channel;
        const filtered = filterContestsByKeywords(upcoming, {
          includeKeywords: subscription.includeKeywords,
          excludeKeywords: subscription.excludeKeywords,
        });
        const contests = getUpcomingWithinWindow(filtered, nowSeconds, subscription.minutesBefore);
        for (const contest of contests) {
          const alreadyNotified = await this.wasNotified(subscription.guildId, contest.id);
          if (alreadyNotified) {
            continue;
          }
          const secondsUntil = contest.startTimeSeconds - nowSeconds;
          const embed = buildReminderEmbed(contest, secondsUntil);
          try {
            const mention = subscription.roleId ? `<@&${subscription.roleId}>` : undefined;
            await textChannel.send({
              content: mention,
              allowedMentions: mention ? { roles: [subscription.roleId!] } : { parse: [] },
              embeds: [embed],
            });
            await this.markNotified(subscription.guildId, contest.id);
            logInfo("Contest reminder sent.", {
              guildId: subscription.guildId,
              channelId: subscription.channelId,
              contestId: contest.id,
              minutesBefore: subscription.minutesBefore,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logWarn("Contest reminder send failed.", {
              guildId: subscription.guildId,
              channelId: subscription.channelId,
              contestId: contest.id,
              error: message,
            });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError("Contest reminder refresh failed.", { error: message });
    } finally {
      this.isTicking = false;
    }
  }

  private async wasNotified(guildId: string, contestId: number): Promise<boolean> {
    const notification = await this.getNotification(guildId, contestId);
    return Boolean(notification);
  }

  private async getNotification(
    guildId: string,
    contestId: number
  ): Promise<{ notified_at: string } | null> {
    const row = await this.db
      .selectFrom("contest_notifications")
      .select("notified_at")
      .where("guild_id", "=", guildId)
      .where("contest_id", "=", contestId)
      .executeTakeFirst();
    return row ?? null;
  }

  private async markNotified(guildId: string, contestId: number): Promise<void> {
    await this.db
      .insertInto("contest_notifications")
      .values({
        guild_id: guildId,
        contest_id: contestId,
        notified_at: new Date().toISOString(),
      })
      .onConflict((oc) => oc.columns(["guild_id", "contest_id"]).doNothing())
      .execute();
  }

  private async cleanupNotifications(cutoffIso: string): Promise<void> {
    await this.db
      .deleteFrom("contest_notifications")
      .where("notified_at", "<", cutoffIso)
      .execute();
  }
}

function getUpcomingWithinWindow(
  contests: Contest[],
  nowSeconds: number,
  minutesBefore: number
): Contest[] {
  const windowSeconds = minutesBefore * 60;
  return contests.filter((contest) => {
    const secondsUntil = contest.startTimeSeconds - nowSeconds;
    return secondsUntil > 0 && secondsUntil <= windowSeconds;
  });
}

function buildReminderEmbed(contest: Contest, secondsUntil: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Contest reminder")
    .setColor(0x3498db)
    .setDescription(
      `[${contest.name}](https://codeforces.com/contest/${contest.id}) starts ${formatDiscordRelativeTime(
        contest.startTimeSeconds
      )}.`
    )
    .addFields(
      { name: "Starts", value: formatDiscordTimestamp(contest.startTimeSeconds), inline: true },
      { name: "Duration", value: formatDuration(contest.durationSeconds), inline: true },
      { name: "Time remaining", value: formatDuration(secondsUntil), inline: true }
    );
  return embed;
}

export const contestReminderIntervalMs = 60_000;
