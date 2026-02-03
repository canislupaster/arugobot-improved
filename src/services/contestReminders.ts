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
import { resolveSendableChannelForService } from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { buildServiceErrorFromException } from "../utils/errors.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import { buildRoleMentionOptions } from "../utils/mentions.js";
import {
  buildReminderSendErrorResult,
  recordReminderSendFailure,
  resolveManualChannel,
} from "../utils/reminders.js";
import { runServiceTick } from "../utils/serviceTicks.js";
import {
  cleanupNotifications,
  clearSubscriptionsWithNotifications,
  getNotification,
  getLastNotificationMap,
  markNotification,
  removeSubscriptionWithNotifications,
} from "../utils/subscriptionCleanup.js";
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
  | { status: "channel_missing_permissions"; channelId: string; missingPermissions: string[] }
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
    return removeSubscriptionWithNotifications(
      this.db,
      { subscriptions: "contest_reminders", notifications: "contest_notifications" },
      guildId,
      subscriptionId
    );
  }

  async clearSubscriptions(guildId: string): Promise<number> {
    return clearSubscriptionsWithNotifications(
      this.db,
      { subscriptions: "contest_reminders", notifications: "contest_notifications" },
      guildId
    );
  }

  async sendManualReminder(
    subscription: ContestReminder,
    client: Client,
    force = false
  ): Promise<ManualContestReminderResult> {
    const channelStatus = await resolveManualChannel(client, subscription.channelId);
    if (channelStatus.status !== "ready") {
      return channelStatus;
    }
    const channel = channelStatus.channel;

    let isStale = false;
    try {
      const refreshScopes = getRefreshScopes([subscription]);
      await Promise.all(refreshScopes.map((scope) => this.contests.refresh(false, scope)));
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
      const notification = await getNotification(
        this.db,
        "contest_notifications",
        subscription.id,
        contest.id
      );
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
      return buildReminderSendErrorResult({
        error,
        record: (entry) => {
          this.lastError = entry;
        },
        log: logWarn,
        logMessage: "Contest reminder send failed (manual).",
        logContext: {
          guildId: subscription.guildId,
          subscriptionId: subscription.id,
          channelId: subscription.channelId,
          contestId: contest.id,
          scope: subscription.scope,
        },
      });
    }
  }

  async runTick(client: Client): Promise<void> {
    await runServiceTick(
      {
        isTicking: this.isTicking,
        setTicking: (value) => {
          this.isTicking = value;
        },
        setLastTickAt: (value) => {
          this.lastTickAt = value;
        },
      },
      async () => {
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
            const { channel: textChannel, serviceError } = await resolveSendableChannelForService({
              client,
              channelId: subscription.channelId,
              warnMessage: "Contest reminder channel missing or invalid.",
              warnContext: {
                guildId: subscription.guildId,
                subscriptionId: subscription.id,
                scope: subscription.scope,
              },
              cleanup: {
                remove: () => this.removeSubscription(subscription.guildId, subscription.id),
                logRemoved: () => {
                  logInfo("Contest reminder subscription removed (channel missing).", {
                    guildId: subscription.guildId,
                    subscriptionId: subscription.id,
                    channelId: subscription.channelId,
                    scope: subscription.scope,
                  });
                },
                logFailed: () => {
                  logWarn("Contest reminder subscription cleanup failed.", {
                    guildId: subscription.guildId,
                    subscriptionId: subscription.id,
                    channelId: subscription.channelId,
                    scope: subscription.scope,
                  });
                },
              },
              serviceLabel: "Contest reminder",
            });
            if (!textChannel) {
              this.lastError = serviceError ?? this.lastError;
              continue;
            }
            const scopedUpcoming = upcomingByScope.get(subscription.scope) ?? [];
            const filtered = filterContestsByKeywords(scopedUpcoming, {
              includeKeywords: subscription.includeKeywords,
              excludeKeywords: subscription.excludeKeywords,
            });
            const contests = getUpcomingWithinWindow(
              filtered,
              nowSeconds,
              subscription.minutesBefore
            );
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
                recordReminderSendFailure({
                  error,
                  record: (entry) => {
                    this.lastError = entry;
                  },
                  log: logWarn,
                  logMessage: "Contest reminder send failed.",
                  logContext: {
                    guildId: subscription.guildId,
                    subscriptionId: subscription.id,
                    channelId: subscription.channelId,
                    contestId: contest.id,
                    minutesBefore: subscription.minutesBefore,
                    scope: subscription.scope,
                  },
                });
              }
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.lastError = { message, timestamp: new Date().toISOString() };
          logError("Contest reminder refresh failed.", { error: message });
        }
      }
    );
  }

  async getLastNotificationMap(subscriptionIds: string[]): Promise<Map<string, string>> {
    return getLastNotificationMap(this.db, "contest_notifications", subscriptionIds);
  }

  private async wasNotified(subscriptionId: string, contestId: number): Promise<boolean> {
    const notification = await getNotification(
      this.db,
      "contest_notifications",
      subscriptionId,
      contestId
    );
    return Boolean(notification);
  }

  private async markNotified(subscriptionId: string, contestId: number): Promise<void> {
    await markNotification(this.db, "contest_notifications", subscriptionId, contestId);
  }

  private async cleanupNotifications(cutoffIso: string): Promise<void> {
    await cleanupNotifications(this.db, "contest_notifications", cutoffIso);
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
