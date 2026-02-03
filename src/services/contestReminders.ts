import { randomUUID } from "node:crypto";

import { EmbedBuilder, type Client } from "discord.js";
import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import {
  filterContestsByKeywords,
  parseKeywordFilters,
  serializeKeywords,
} from "../utils/contestFilters.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import { resolveSendableChannel, resolveSendableChannelOrWarn } from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import {
  buildServiceErrorFromException,
  recordServiceErrorMessage,
} from "../utils/errors.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import { buildRoleMentionOptions } from "../utils/mentions.js";
import {
  formatDiscordRelativeTime,
  formatDiscordTimestamp,
  formatDuration,
} from "../utils/time.js";

import type { Contest, ContestScope, ContestScopeFilter, ContestService } from "./contests.js";

const NOTIFICATION_RETENTION_DAYS = 14;

export type ContestReminder = {
  id: string;
  guildId: string;
  channelId: string;
  minutesBefore: number;
  roleId: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  scope: ContestScopeFilter;
};

export type ManualContestReminderResult =
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

const DEFAULT_SCOPE: ContestScopeFilter = "official";

function normalizeScope(raw: string | null | undefined): ContestScopeFilter {
  if (raw === "official" || raw === "gym" || raw === "all") {
    return raw;
  }
  return DEFAULT_SCOPE;
}

function getRefreshScopes(subscriptions: ContestReminder[]): ContestScope[] {
  const scopes = new Set<ContestScope>();
  for (const subscription of subscriptions) {
    if (subscription.scope === "official" || subscription.scope === "all") {
      scopes.add("official");
    }
    if (subscription.scope === "gym" || subscription.scope === "all") {
      scopes.add("gym");
    }
  }
  return Array.from(scopes);
}

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

  async getSubscriptionById(
    guildId: string,
    subscriptionId: string
  ): Promise<ContestReminder | null> {
    const row = await this.db
      .selectFrom("contest_reminders")
      .select([
        "id",
        "guild_id",
        "channel_id",
        "minutes_before",
        "role_id",
        "include_keywords",
        "exclude_keywords",
        "scope",
      ])
      .where("guild_id", "=", guildId)
      .where("id", "=", subscriptionId)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    const filters = parseKeywordFilters(row.include_keywords, row.exclude_keywords);
    return {
      id: row.id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      minutesBefore: row.minutes_before,
      roleId: row.role_id ?? null,
      includeKeywords: filters.includeKeywords,
      excludeKeywords: filters.excludeKeywords,
      scope: normalizeScope(row.scope),
    };
  }

  async listSubscriptions(guildId?: string): Promise<ContestReminder[]> {
    let query = this.db
      .selectFrom("contest_reminders")
      .select([
        "id",
        "guild_id",
        "channel_id",
        "minutes_before",
        "role_id",
        "include_keywords",
        "exclude_keywords",
        "scope",
      ])
      .orderBy("created_at");
    if (guildId) {
      query = query.where("guild_id", "=", guildId);
    }
    const rows = await query.execute();
    return rows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      minutesBefore: row.minutes_before,
      roleId: row.role_id ?? null,
      ...parseKeywordFilters(row.include_keywords, row.exclude_keywords),
      scope: normalizeScope(row.scope),
    }));
  }

  async getSubscriptionCount(): Promise<number> {
    const row = await this.db
      .selectFrom("contest_reminders")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  async createSubscription(
    guildId: string,
    channelId: string,
    minutesBefore: number,
    roleId: string | null,
    includeKeywords: string[],
    excludeKeywords: string[],
    scope: ContestScopeFilter
  ): Promise<ContestReminder> {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    await this.db
      .insertInto("contest_reminders")
      .values({
        id,
        guild_id: guildId,
        channel_id: channelId,
        minutes_before: minutesBefore,
        role_id: roleId,
        include_keywords: serializeKeywords(includeKeywords),
        exclude_keywords: serializeKeywords(excludeKeywords),
        scope,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute();
    return {
      id,
      guildId,
      channelId,
      minutesBefore,
      roleId,
      includeKeywords,
      excludeKeywords,
      scope,
    };
  }

  async removeSubscription(guildId: string, subscriptionId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const result = await trx
        .deleteFrom("contest_reminders")
        .where("guild_id", "=", guildId)
        .where("id", "=", subscriptionId)
        .executeTakeFirst();
      const removed = Number(result.numDeletedRows ?? 0) > 0;
      if (removed) {
        await trx
          .deleteFrom("contest_notifications")
          .where("subscription_id", "=", subscriptionId)
          .execute();
      }
      return removed;
    });
  }

  async clearSubscriptions(guildId: string): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const subscriptions = await trx
        .selectFrom("contest_reminders")
        .select("id")
        .where("guild_id", "=", guildId)
        .execute();
      if (subscriptions.length === 0) {
        return 0;
      }
      const ids = subscriptions.map((subscription) => subscription.id);
      await trx.deleteFrom("contest_notifications").where("subscription_id", "in", ids).execute();
      const result = await trx
        .deleteFrom("contest_reminders")
        .where("guild_id", "=", guildId)
        .executeTakeFirst();
      return Number(result.numDeletedRows ?? 0);
    });
  }

  async sendManualReminder(
    subscription: ContestReminder,
    client: Client,
    force = false
  ): Promise<ManualContestReminderResult> {
    const channel = await resolveSendableChannel(client, subscription.channelId);
    if (!channel) {
      return { status: "channel_missing", channelId: subscription.channelId };
    }

    let isStale = false;
    try {
      if (subscription.scope === "all") {
        await Promise.all([
          this.contests.refresh(false, "official"),
          this.contests.refresh(false, "gym"),
        ]);
    } else {
        await this.contests.refresh(false, subscription.scope);
      }
    } catch (error) {
      isStale = true;
      const serviceError = buildServiceErrorFromException(error);
      this.lastError = serviceError;
      logWarn("Contest reminder refresh failed; using cached contests.", {
        error: serviceError.message,
      });
    }

    const upcoming = this.contests.getUpcomingContests(subscription.scope);
    const filtered = filterContestsByKeywords(upcoming, {
      includeKeywords: subscription.includeKeywords,
      excludeKeywords: subscription.excludeKeywords,
    });

    if (filtered.length === 0) {
      return { status: "no_contest" };
    }

    const contest = filtered[0]!;
    if (!force) {
      const notification = await this.getNotification(subscription.id, contest.id);
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
      const { mention, allowedMentions } = buildRoleMentionOptions(subscription.roleId);
      await channel.send({
        content: mention,
        allowedMentions,
        embeds: [embed],
      });
      await this.markNotified(subscription.id, contest.id);
      logInfo("Contest reminder sent (manual).", {
        guildId: subscription.guildId,
        subscriptionId: subscription.id,
        channelId: subscription.channelId,
        contestId: contest.id,
        minutesBefore: subscription.minutesBefore,
        scope: subscription.scope,
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
      const message = recordServiceErrorMessage(error, (entry) => {
        this.lastError = entry;
      });
      logWarn("Contest reminder send failed (manual).", {
        guildId: subscription.guildId,
        subscriptionId: subscription.id,
        channelId: subscription.channelId,
        contestId: contest.id,
        scope: subscription.scope,
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
        const serviceError = buildServiceErrorFromException(error);
        this.lastError = serviceError;
        logError("Contest reminder subscription load failed.", {
          error: serviceError.message,
        });
        return;
      }

      if (subscriptions.length === 0) {
        return;
      }

      let refreshFailed = false;
      const recordRefreshFailure = (error: unknown) => {
        refreshFailed = true;
        const serviceError = buildServiceErrorFromException(error);
        this.lastError = serviceError;
        logWarn("Contest reminder refresh failed; using cached contests.", {
          error: serviceError.message,
        });
      };
      try {
        const refreshScopes = getRefreshScopes(subscriptions);
        const results = await Promise.allSettled(
          refreshScopes.map((scope) => this.contests.refresh(false, scope))
        );
        const rejected = results.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        if (rejected.length > 0) {
          recordRefreshFailure(rejected[0]?.reason);
        }
      } catch (error) {
        recordRefreshFailure(error);
      }

      const upcomingByScope = new Map<ContestScopeFilter, Contest[]>();
      const requestedScopes = new Set(subscriptions.map((subscription) => subscription.scope));
      if (requestedScopes.has("official")) {
        upcomingByScope.set("official", this.contests.getUpcomingContests("official"));
      }
      if (requestedScopes.has("gym")) {
        upcomingByScope.set("gym", this.contests.getUpcomingContests("gym"));
      }
      if (requestedScopes.has("all")) {
        upcomingByScope.set("all", this.contests.getUpcomingContests("all"));
      }

      const totalUpcoming = Array.from(upcomingByScope.values()).reduce(
        (count, entries) => count + entries.length,
        0
      );
      if (totalUpcoming === 0) {
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
        logWarn("Contest reminder cleanup failed.", {
          error: buildServiceErrorFromException(error).message,
        });
      }

      for (const subscription of subscriptions) {
        const textChannel = await resolveSendableChannelOrWarn(
          client,
          subscription.channelId,
          "Contest reminder channel missing or invalid.",
          { guildId: subscription.guildId }
        );
        if (!textChannel) {
          continue;
        }
        const scopedUpcoming = upcomingByScope.get(subscription.scope) ?? [];
        const filtered = filterContestsByKeywords(scopedUpcoming, {
          includeKeywords: subscription.includeKeywords,
          excludeKeywords: subscription.excludeKeywords,
        });
        const contests = getUpcomingWithinWindow(filtered, nowSeconds, subscription.minutesBefore);
        for (const contest of contests) {
          const alreadyNotified = await this.wasNotified(subscription.id, contest.id);
          if (alreadyNotified) {
            continue;
          }
          const secondsUntil = contest.startTimeSeconds - nowSeconds;
          const embed = buildReminderEmbed(contest, secondsUntil);
          try {
            const { mention, allowedMentions } = buildRoleMentionOptions(subscription.roleId);
            await textChannel.send({
              content: mention,
              allowedMentions,
              embeds: [embed],
            });
            await this.markNotified(subscription.id, contest.id);
            logInfo("Contest reminder sent.", {
              guildId: subscription.guildId,
              subscriptionId: subscription.id,
              channelId: subscription.channelId,
              contestId: contest.id,
              minutesBefore: subscription.minutesBefore,
              scope: subscription.scope,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logWarn("Contest reminder send failed.", {
              guildId: subscription.guildId,
              channelId: subscription.channelId,
              contestId: contest.id,
              scope: subscription.scope,
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

  private async wasNotified(subscriptionId: string, contestId: number): Promise<boolean> {
    const notification = await this.getNotification(subscriptionId, contestId);
    return Boolean(notification);
  }

  private async getNotification(
    subscriptionId: string,
    contestId: number
  ): Promise<{ notified_at: string } | null> {
    const row = await this.db
      .selectFrom("contest_notifications")
      .select("notified_at")
      .where("subscription_id", "=", subscriptionId)
      .where("contest_id", "=", contestId)
      .executeTakeFirst();
    return row ?? null;
  }

  private async markNotified(subscriptionId: string, contestId: number): Promise<void> {
    await this.db
      .insertInto("contest_notifications")
      .values({
        subscription_id: subscriptionId,
        contest_id: contestId,
        notified_at: new Date().toISOString(),
      })
      .onConflict((oc) => oc.columns(["subscription_id", "contest_id"]).doNothing())
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
    .setColor(EMBED_COLORS.info)
    .setDescription(
      `[${contest.name}](${buildContestUrl(contest)}) starts ${formatDiscordRelativeTime(
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
