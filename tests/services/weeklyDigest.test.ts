import { ChannelType } from "discord.js";
import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import type { ContestActivityService } from "../../src/services/contestActivity.js";
import type { StoreService } from "../../src/services/store.js";
import {
  getNextWeeklyScheduledUtcMs,
  WeeklyDigestService,
} from "../../src/services/weeklyDigest.js";

const mockStore = {
  getChallengeActivity: jest.fn().mockResolvedValue({
    completedChallenges: 1,
    participantCount: 2,
    uniqueParticipants: 2,
    solvedCount: 1,
    topSolvers: [{ userId: "user-1", solvedCount: 1 }],
  }),
} as unknown as StoreService;

const mockContestActivity = {
  getGuildContestActivity: jest.fn().mockResolvedValue({
    lookbackDays: 7,
    contestCount: 1,
    participantCount: 1,
    topContests: [
      {
        contestId: 100,
        contestName: "Weekly Contest",
        participantCount: 1,
        ratingUpdateTimeSeconds: 1_700_000_000,
        scope: "official",
      },
    ],
    recentContests: [
      {
        contestId: 100,
        contestName: "Weekly Contest",
        ratingUpdateTimeSeconds: 1_700_000_000,
        scope: "official",
      },
    ],
    byScope: {
      official: { contestCount: 1, participantCount: 1, lastContestAt: 1_700_000_000 },
      gym: { contestCount: 0, participantCount: 0, lastContestAt: null },
    },
    participants: [{ userId: "user-1", handle: "alice", contestCount: 1, lastContestAt: null }],
  }),
  getGuildRatingChangeSummary: jest.fn().mockResolvedValue({
    lookbackDays: 7,
    contestCount: 1,
    participantCount: 1,
    totalDelta: 42,
    lastContestAt: 1_700_000_000,
    topGainers: [
      {
        userId: "user-1",
        handle: "alice",
        contestCount: 1,
        delta: 42,
        lastContestAt: 1_700_000_000,
      },
    ],
    topLosers: [],
  }),
} as unknown as ContestActivityService;

describe("WeeklyDigestService", () => {
  let db: Kysely<Database>;
  let service: WeeklyDigestService;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    service = new WeeklyDigestService(db, mockStore, mockContestActivity);
    await service.setSubscription("guild-1", "channel-1", 1, 9, 0, 0, null);
  });

  afterEach(async () => {
    await db.destroy();
    jest.useRealTimers();
  });

  it("computes the next scheduled weekly digest", () => {
    const now = new Date("2024-01-08T08:00:00.000Z");
    const next = getNextWeeklyScheduledUtcMs(now, 1, 9, 0, 0);
    expect(new Date(next).toISOString()).toBe("2024-01-08T09:00:00.000Z");
  });

  it("returns a preview with an embed", async () => {
    const preview = await service.getPreview("guild-1");
    expect(preview).not.toBeNull();
    expect(preview?.embed.data.title).toBe("Weekly digest");
    const fieldNames = preview?.embed.data.fields?.map((field) => field.name) ?? [];
    expect(fieldNames).toContain("Rating changes");
    expect(fieldNames).toContain("Top contests");
  });

  it("blocks manual posts already sent this week", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-10T12:00:00.000Z"));
    await db
      .updateTable("weekly_digests")
      .set({ last_sent_at: new Date().toISOString() })
      .where("guild_id", "=", "guild-1")
      .execute();
    const result = await service.sendManualDigest("guild-1", {
      channels: { fetch: jest.fn() },
    } as never);
    expect(result.status).toBe("already_sent");
  });

  it("sends the digest manually", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const result = await service.sendManualDigest("guild-1", {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: ChannelType.GuildText,
          send,
        }),
      },
    } as never);
    expect(result.status).toBe("sent");
    expect(send).toHaveBeenCalled();
  });

  it("returns channel_missing_permissions when manual digest channel lacks permissions", async () => {
    const result = await service.sendManualDigest("guild-1", {
      user: { id: "bot-1" },
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: ChannelType.GuildText,
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(false),
          }),
        }),
      },
    } as never);
    expect(result).toEqual({
      status: "channel_missing_permissions",
      channelId: "channel-1",
      missingPermissions: ["ViewChannel", "SendMessages"],
    });
  });

  it("keeps sending when a scheduled digest fails", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-08T09:05:00.000Z"));

    await service.setSubscription("guild-2", "channel-2", 1, 9, 0, 0, null);

    const sendFail = jest.fn().mockRejectedValue(new Error("send failed"));
    const sendOk = jest.fn().mockResolvedValue(undefined);
    const client = {
      channels: {
        fetch: jest.fn().mockImplementation((channelId: string) => {
          if (channelId === "channel-1") {
            return Promise.resolve({ type: ChannelType.GuildText, send: sendFail });
          }
          if (channelId === "channel-2") {
            return Promise.resolve({ type: ChannelType.GuildText, send: sendOk });
          }
          return Promise.resolve(null);
        }),
      },
    } as never;

    await service.runTick(client);

    expect(sendFail).toHaveBeenCalledTimes(1);
    expect(sendOk).toHaveBeenCalledTimes(1);
  });

  it("cleans up missing channels during scheduled ticks", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-08T09:05:00.000Z"));

    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as never;

    await service.runTick(client);

    const subscription = await service.getSubscription("guild-1");
    expect(subscription).toBeNull();
  });
});
