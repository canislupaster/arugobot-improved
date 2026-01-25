import { randomUUID } from "node:crypto";

import { EmbedBuilder, type Client } from "discord.js";
import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import { resolveSendableChannel } from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import { buildRoleMentionOptions } from "../utils/mentions.js";
import { formatDiscordRelativeTime, formatDiscordTimestamp } from "../utils/time.js";

import type { ContestRatingChangesService } from "./contestRatingChanges.js";
import type { Contest, ContestService } from "./contests.js";
import type { RatingChange } from "./ratingChanges.js";
import type { StoreService } from "./store.js";

const ALERT_LOOKBACK_DAYS = 14;
const ALERT_RETENTION_DAYS = 90;
const MAX_CONTESTS_TO_CHECK = 6;
const MAX_ENTRIES = 12;

export type ContestRatingAlertSubscription = {
  id: string;
  guildId: string;
  channelId: string;
  roleId: string | null;
  minDelta: number;
  includeHandles: string[];
};

export type ContestRatingAlertEntry = {
  handle: string;
  userId?: string;
  change: RatingChange;
};

export type ContestRatingAlertPreview = {
  contest: Contest;
  entries: ContestRatingAlertEntry[];
  totalEntries: number;
  isStale: boolean;
};

export type ManualContestRatingAlertResult =
  | { status: "channel_missing"; channelId: string }
  | { status: "no_handles" }
  | { status: "no_matching_handles" }
  | { status: "no_contest" }
  | { status: "no_changes"; contestId: number; contestName: string }
  | { status: "already_notified"; contestId: number; contestName: string; notifiedAt: string }
  | {
      status: "sent";
      contestId: number;
      contestName: string;
      channelId: string;
      entryCount: number;
      isStale: boolean;
    }
  | { status: "error"; message: string };

type ContestProvider = Pick<ContestService, "refresh" | "getFinished">;
type RatingChangesProvider = Pick<ContestRatingChangesService, "getContestRatingChanges">;
type StoreProvider = Pick<StoreService, "getLinkedUsers">;

type AlertCandidateResult =
  | { status: "no_handles" }
  | { status: "no_matching_handles" }
  | { status: "no_contest" }
  | { status: "no_changes"; contest: Contest }
  | { status: "already_notified"; contest: Contest; notifiedAt: string }
  | { status: "ready"; preview: ContestRatingAlertPreview }
  | { status: "error"; message: string };

type AlertCandidateOptions = {
  force?: boolean;
  skipNotified?: boolean;
  maxContests?: number;
};

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function parseHandleFilter(value: string | null): string[] {
  if (!value) {
    return [];
  }
  const entries = value
    .split(",")
    .map((handle) => normalizeHandle(handle))
    .filter((handle) => handle.length > 0);
  return Array.from(new Set(entries));
}

function serializeHandleFilter(handles: string[]): string | null {
  if (handles.length === 0) {
    return null;
  }
  return Array.from(new Set(handles.map((handle) => normalizeHandle(handle)))).join(",");
}

function formatDelta(delta: number): string {
  return delta >= 0 ? `+${delta}` : String(delta);
}

function formatEntryLabel(entry: ContestRatingAlertEntry): string {
  if (entry.userId) {
    return `<@${entry.userId}> (${entry.handle})`;
  }
  return entry.handle;
}

export function buildContestRatingAlertEmbed(preview: ContestRatingAlertPreview): EmbedBuilder {
  const sorted = preview.entries.slice().sort((a, b) => a.change.rank - b.change.rank);
  const totalEntries = preview.totalEntries;
  const limited = sorted.slice(0, MAX_ENTRIES);
  const updateTimeSeconds =
    limited[0]?.change.ratingUpdateTimeSeconds ?? preview.contest.startTimeSeconds;
  const lines = limited.map((entry) => {
    const delta = entry.change.newRating - entry.change.oldRating;
    const rank = entry.change.rank > 0 ? `#${entry.change.rank}` : "Unranked";
    return `${rank} ${formatEntryLabel(entry)} • ${entry.change.oldRating} → ${
      entry.change.newRating
    } (${formatDelta(delta)})`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Contest rating changes published")
    .setColor(EMBED_COLORS.info)
    .setDescription(`[${preview.contest.name}](${buildContestUrl(preview.contest)})`)
    .addFields(
      {
        name: "Updated",
        value: `${formatDiscordTimestamp(updateTimeSeconds)} (${formatDiscordRelativeTime(
          updateTimeSeconds
        )})`,
        inline: false,
      },
      { name: "Changes", value: lines.join("\n"), inline: false }
    );

  const footerNotes: string[] = [];
  if (totalEntries > limited.length) {
    footerNotes.push(`Showing top ${limited.length} of ${totalEntries} entries.`);
  }
  if (preview.isStale) {
    footerNotes.push("Showing cached data due to a temporary Codeforces error.");
  }
  if (footerNotes.length > 0) {
    embed.setFooter({ text: footerNotes.join(" ") });
  }

  return embed;
}

export class ContestRatingAlertService {
  private lastTickAt: string | null = null;
  private lastError: { message: string; timestamp: string } | null = null;
  private isTicking = false;

  constructor(
    private db: Kysely<Database>,
    private contests: ContestProvider,
    private ratingChanges: RatingChangesProvider,
    private store: StoreProvider
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
  ): Promise<ContestRatingAlertSubscription | null> {
    const row = await this.db
      .selectFrom("contest_rating_alert_subscriptions")
      .select(["id", "guild_id", "channel_id", "role_id", "min_delta", "include_handles"])
      .where("guild_id", "=", guildId)
      .where("id", "=", subscriptionId)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      roleId: row.role_id ?? null,
      minDelta: row.min_delta ?? 0,
      includeHandles: parseHandleFilter(row.include_handles),
    };
  }

  async listSubscriptions(guildId?: string): Promise<ContestRatingAlertSubscription[]> {
    let query = this.db
      .selectFrom("contest_rating_alert_subscriptions")
      .select(["id", "guild_id", "channel_id", "role_id", "min_delta", "include_handles"])
      .orderBy("created_at");
    if (guildId) {
      query = query.where("guild_id", "=", guildId);
    }
    const rows = await query.execute();
    return rows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      roleId: row.role_id ?? null,
      minDelta: row.min_delta ?? 0,
      includeHandles: parseHandleFilter(row.include_handles),
    }));
  }

  async getSubscriptionCount(): Promise<number> {
    const row = await this.db
      .selectFrom("contest_rating_alert_subscriptions")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  async createSubscription(
    guildId: string,
    channelId: string,
    roleId: string | null,
    options: { minDelta?: number; includeHandles?: string[] } = {}
  ): Promise<ContestRatingAlertSubscription> {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const minDelta = Math.max(0, options.minDelta ?? 0);
    const includeHandles = options.includeHandles ?? [];
    await this.db
      .insertInto("contest_rating_alert_subscriptions")
      .values({
        id,
        guild_id: guildId,
        channel_id: channelId,
        role_id: roleId,
        min_delta: minDelta,
        include_handles: serializeHandleFilter(includeHandles),
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute();
    return { id, guildId, channelId, roleId, minDelta, includeHandles };
  }

  async removeSubscription(guildId: string, subscriptionId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const result = await trx
        .deleteFrom("contest_rating_alert_subscriptions")
        .where("guild_id", "=", guildId)
        .where("id", "=", subscriptionId)
        .executeTakeFirst();
      const removed = Number(result.numDeletedRows ?? 0) > 0;
      if (removed) {
        await trx
          .deleteFrom("contest_rating_alert_notifications")
          .where("subscription_id", "=", subscriptionId)
          .execute();
      }
      return removed;
    });
  }

  async clearSubscriptions(guildId: string): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const subscriptions = await trx
        .selectFrom("contest_rating_alert_subscriptions")
        .select("id")
        .where("guild_id", "=", guildId)
        .execute();
      if (subscriptions.length === 0) {
        return 0;
      }
      const ids = subscriptions.map((subscription) => subscription.id);
      await trx
        .deleteFrom("contest_rating_alert_notifications")
        .where("subscription_id", "in", ids)
        .execute();
      const result = await trx
        .deleteFrom("contest_rating_alert_subscriptions")
        .where("guild_id", "=", guildId)
        .executeTakeFirst();
      return Number(result.numDeletedRows ?? 0);
    });
  }

  async getPreview(subscription: ContestRatingAlertSubscription): Promise<AlertCandidateResult> {
    const { contests, isStale, error } = await this.loadContestContext();
    if (error) {
      return { status: "error", message: error };
    }
    return this.findCandidate(subscription, contests, isStale, {
      skipNotified: false,
      force: false,
    });
  }

  async sendManualAlert(
    subscription: ContestRatingAlertSubscription,
    client: Client,
    force = false
  ): Promise<ManualContestRatingAlertResult> {
    const channel = await resolveSendableChannel(client, subscription.channelId);
    if (!channel) {
      return { status: "channel_missing", channelId: subscription.channelId };
    }

    const { contests, isStale, error } = await this.loadContestContext();
    if (error) {
      return { status: "error", message: error };
    }

    const candidate = await this.findCandidate(subscription, contests, isStale, {
      skipNotified: false,
      force,
    });

    if (candidate.status === "no_handles") {
      return { status: "no_handles" };
    }
    if (candidate.status === "no_matching_handles") {
      return { status: "no_matching_handles" };
    }
    if (candidate.status === "no_contest") {
      return { status: "no_contest" };
    }
    if (candidate.status === "no_changes") {
      return {
        status: "no_changes",
        contestId: candidate.contest.id,
        contestName: candidate.contest.name,
      };
    }
    if (candidate.status === "already_notified") {
      return {
        status: "already_notified",
        contestId: candidate.contest.id,
        contestName: candidate.contest.name,
        notifiedAt: candidate.notifiedAt,
      };
    }
    if (candidate.status === "error") {
      return { status: "error", message: candidate.message };
    }

    const embed = buildContestRatingAlertEmbed(candidate.preview);
    try {
      const { mention, allowedMentions } = buildRoleMentionOptions(subscription.roleId);
      await channel.send({
        content: mention,
        allowedMentions,
        embeds: [embed],
      });
      await this.markNotified(subscription.id, candidate.preview.contest.id);
      logInfo("Contest rating alert sent (manual).", {
        guildId: subscription.guildId,
        subscriptionId: subscription.id,
        channelId: subscription.channelId,
        contestId: candidate.preview.contest.id,
        entryCount: candidate.preview.totalEntries,
        isStale: candidate.preview.isStale,
      });
      return {
        status: "sent",
        contestId: candidate.preview.contest.id,
        contestName: candidate.preview.contest.name,
        channelId: subscription.channelId,
        entryCount: candidate.preview.totalEntries,
        isStale: candidate.preview.isStale,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logWarn("Contest rating alert send failed (manual).", {
        guildId: subscription.guildId,
        subscriptionId: subscription.id,
        channelId: subscription.channelId,
        contestId: candidate.preview.contest.id,
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
      let subscriptions: ContestRatingAlertSubscription[] = [];
      try {
        subscriptions = await this.listSubscriptions();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = { message, timestamp: new Date().toISOString() };
        logError("Contest rating alert subscription load failed.", { error: message });
        return;
      }

      if (subscriptions.length === 0) {
        return;
      }

      const { contests, isStale, error } = await this.loadContestContext();
      if (error) {
        return;
      }
      if (contests.length === 0) {
        return;
      }

      const cutoff = new Date(
        Date.now() - ALERT_RETENTION_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      try {
        await this.cleanupNotifications(cutoff);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWarn("Contest rating alert cleanup failed.", { error: message });
      }

      for (const subscription of subscriptions) {
        const channel = await resolveSendableChannel(client, subscription.channelId);
        if (!channel) {
          logWarn("Contest rating alert channel missing or invalid.", {
            guildId: subscription.guildId,
            channelId: subscription.channelId,
          });
          continue;
        }

        const candidate = await this.findCandidate(subscription, contests, isStale, {
          skipNotified: true,
          force: false,
          maxContests: MAX_CONTESTS_TO_CHECK,
        });

        if (candidate.status !== "ready") {
          continue;
        }

        const embed = buildContestRatingAlertEmbed(candidate.preview);
        try {
          const { mention, allowedMentions } = buildRoleMentionOptions(subscription.roleId);
          await channel.send({
            content: mention,
            allowedMentions,
            embeds: [embed],
          });
          await this.markNotified(subscription.id, candidate.preview.contest.id);
          logInfo("Contest rating alert sent.", {
            guildId: subscription.guildId,
            subscriptionId: subscription.id,
            channelId: subscription.channelId,
            contestId: candidate.preview.contest.id,
            entryCount: candidate.preview.totalEntries,
            isStale: candidate.preview.isStale,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logWarn("Contest rating alert send failed.", {
            guildId: subscription.guildId,
            channelId: subscription.channelId,
            contestId: candidate.preview.contest.id,
            error: message,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError("Contest rating alert tick failed.", { error: message });
    } finally {
      this.isTicking = false;
    }
  }

  private async loadContestContext(): Promise<{
    contests: Contest[];
    isStale: boolean;
    error?: string;
  }> {
    let isStale = false;
    try {
      await this.contests.refresh();
    } catch (error) {
      isStale = true;
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logWarn("Contest rating alert refresh failed; using cached contests.", { error: message });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const sinceSeconds = nowSeconds - ALERT_LOOKBACK_DAYS * 24 * 60 * 60;
    const contests = this.contests.getFinished(MAX_CONTESTS_TO_CHECK, sinceSeconds);
    if (contests.length === 0 && !isStale) {
      return { contests, isStale, error: undefined };
    }
    if (contests.length === 0 && isStale) {
      return { contests, isStale, error: "No cached contests available." };
    }
    return { contests, isStale, error: undefined };
  }

  private async findCandidate(
    subscription: ContestRatingAlertSubscription,
    contests: Contest[],
    isStale: boolean,
    options: AlertCandidateOptions
  ): Promise<AlertCandidateResult> {
    const linkedUsers = await this.store.getLinkedUsers(subscription.guildId);
    if (linkedUsers.length === 0) {
      return { status: "no_handles" };
    }

    const maxContests = options.maxContests ?? MAX_CONTESTS_TO_CHECK;
    const recent = contests.slice(0, Math.max(1, maxContests));
    if (recent.length === 0) {
      return { status: "no_contest" };
    }

    let handleMap = new Map(
      linkedUsers.map((entry) => [normalizeHandle(entry.handle), entry.userId])
    );
    if (subscription.includeHandles.length > 0) {
      const allowedHandles = new Set(
        subscription.includeHandles.map((handle) => normalizeHandle(handle))
      );
      handleMap = new Map(
        Array.from(handleMap.entries()).filter(([handle]) => allowedHandles.has(handle))
      );
      if (handleMap.size === 0) {
        return { status: "no_matching_handles" };
      }
    }
    const firstContest = recent[0]!;

    for (const contest of recent) {
      if (!options.force) {
        const notification = await this.getNotification(subscription.id, contest.id);
        if (notification) {
          if (options.skipNotified) {
            continue;
          }
          return {
            status: "already_notified",
            contest,
            notifiedAt: notification.notified_at,
          };
        }
      }

      const changesResult = await this.ratingChanges.getContestRatingChanges(contest.id);
      if (!changesResult || changesResult.changes.length === 0) {
        continue;
      }

      const entries = changesResult.changes
        .filter((change) => change.handle && handleMap.has(normalizeHandle(change.handle)))
        .map((change) => {
          const handle = change.handle ?? "unknown";
          return {
            handle,
            userId: handleMap.get(normalizeHandle(handle)),
            change,
          };
        });

      const minDelta = Math.max(0, subscription.minDelta);
      const filteredEntries =
        minDelta > 0
          ? entries.filter(
              (entry) => Math.abs(entry.change.newRating - entry.change.oldRating) >= minDelta
            )
          : entries;

      if (filteredEntries.length === 0) {
        continue;
      }

      return {
        status: "ready",
        preview: {
          contest,
          entries: filteredEntries,
          totalEntries: filteredEntries.length,
          isStale: isStale || changesResult.isStale,
        },
      };
    }

    return { status: "no_changes", contest: firstContest };
  }

  private async getNotification(
    subscriptionId: string,
    contestId: number
  ): Promise<{ notified_at: string } | null> {
    const row = await this.db
      .selectFrom("contest_rating_alert_notifications")
      .select("notified_at")
      .where("subscription_id", "=", subscriptionId)
      .where("contest_id", "=", contestId)
      .executeTakeFirst();
    return row ?? null;
  }

  private async markNotified(subscriptionId: string, contestId: number): Promise<void> {
    await this.db
      .insertInto("contest_rating_alert_notifications")
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
      .deleteFrom("contest_rating_alert_notifications")
      .where("notified_at", "<", cutoffIso)
      .execute();
  }
}

export const contestRatingAlertIntervalMs = 5 * 60_000;
