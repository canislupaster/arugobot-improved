import { ChannelType, type Client } from "discord.js";
import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { PracticeReminderService } from "../../src/services/practiceReminders.js";

const createMockClient = (send: jest.Mock) =>
  ({
    channels: {
      fetch: jest.fn().mockResolvedValue({
        type: ChannelType.GuildText,
        send,
      }),
    },
  }) as unknown as Client;

describe("PracticeReminderService", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
  });

  afterEach(async () => {
    await db.destroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("sends practice reminders and records posts", async () => {
    const nowMs = Date.UTC(2024, 0, 1, 10, 0, 0);
    jest.useFakeTimers().setSystemTime(new Date(nowMs));

    const problems = [
      {
        contestId: 100,
        index: "A",
        name: "Sample",
        rating: 1200,
        tags: ["dp"],
      },
    ];

    const service = new PracticeReminderService(
      db,
      {
        ensureProblemsLoaded: jest.fn().mockResolvedValue(problems),
      } as never,
      {
        getLinkedUsers: jest.fn().mockResolvedValue([]),
        getHistoryList: jest.fn().mockResolvedValue([]),
        getSolvedProblems: jest.fn().mockResolvedValue([]),
      } as never
    );

    await service.setSubscription(
      "guild-1",
      "channel-1",
      9,
      0,
      0,
      [{ min: 800, max: 1400 }],
      "",
      "role-1"
    );
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    await service.runTick(client);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      content: "<@&role-1>",
      allowedMentions: { roles: ["role-1"] },
      embeds: expect.any(Array),
    });
    const posts = await db.selectFrom("practice_posts").selectAll().execute();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.problem_id).toBe("100A");
  });

  it("returns recent practice posts in descending order", async () => {
    const service = new PracticeReminderService(
      db,
      {
        ensureProblemsLoaded: jest.fn().mockResolvedValue([]),
      } as never,
      {
        getLinkedUsers: jest.fn().mockResolvedValue([]),
        getHistoryList: jest.fn().mockResolvedValue([]),
        getSolvedProblems: jest.fn().mockResolvedValue([]),
      } as never
    );

    await db
      .insertInto("practice_posts")
      .values([
        {
          guild_id: "guild-1",
          problem_id: "1000A",
          sent_at: "2024-01-01T00:00:00.000Z",
        },
        {
          guild_id: "guild-1",
          problem_id: "1000B",
          sent_at: "2024-01-03T00:00:00.000Z",
        },
        {
          guild_id: "guild-1",
          problem_id: "1000C",
          sent_at: "2024-01-02T00:00:00.000Z",
        },
      ])
      .execute();

    const posts = await service.getRecentPosts("guild-1", 2);
    expect(posts).toEqual([
      { problemId: "1000B", sentAt: "2024-01-03T00:00:00.000Z" },
      { problemId: "1000C", sentAt: "2024-01-02T00:00:00.000Z" },
    ]);
  });

  it("skips reminders already sent today", async () => {
    const nowMs = Date.UTC(2024, 0, 1, 12, 0, 0);
    jest.useFakeTimers().setSystemTime(new Date(nowMs));

    const problems = [
      {
        contestId: 200,
        index: "B",
        name: "Sample",
        rating: 1200,
        tags: ["dp"],
      },
    ];

    const service = new PracticeReminderService(
      db,
      {
        ensureProblemsLoaded: jest.fn().mockResolvedValue(problems),
      } as never,
      {
        getLinkedUsers: jest.fn().mockResolvedValue([]),
        getHistoryList: jest.fn().mockResolvedValue([]),
        getSolvedProblems: jest.fn().mockResolvedValue([]),
      } as never
    );

    await service.setSubscription(
      "guild-1",
      "channel-1",
      9,
      0,
      0,
      [{ min: 800, max: 1400 }],
      "",
      null
    );
    await db
      .updateTable("practice_reminders")
      .set({ last_sent_at: new Date(nowMs).toISOString() })
      .where("guild_id", "=", "guild-1")
      .execute();
    const subscription = await service.getSubscription("guild-1");
    expect(subscription?.lastSentAt).toBe(new Date(nowMs).toISOString());

    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    await service.runTick(client);

    expect(send).not.toHaveBeenCalled();
  });

  it("stores UTC offset minutes with the subscription", async () => {
    const service = new PracticeReminderService(
      db,
      {
        ensureProblemsLoaded: jest.fn().mockResolvedValue([]),
      } as never,
      {
        getLinkedUsers: jest.fn().mockResolvedValue([]),
        getHistoryList: jest.fn().mockResolvedValue([]),
        getSolvedProblems: jest.fn().mockResolvedValue([]),
      } as never
    );

    await service.setSubscription(
      "guild-1",
      "channel-1",
      6,
      30,
      150,
      [{ min: 800, max: 1400 }],
      "",
      null
    );

    const subscription = await service.getSubscription("guild-1");
    expect(subscription?.utcOffsetMinutes).toBe(150);
  });

  it("sends manual reminders and blocks duplicate sends without force", async () => {
    const nowMs = Date.UTC(2024, 0, 1, 10, 0, 0);
    jest.useFakeTimers().setSystemTime(new Date(nowMs));

    const problems = [
      {
        contestId: 150,
        index: "D",
        name: "Manual",
        rating: 1100,
        tags: ["greedy"],
      },
    ];

    const service = new PracticeReminderService(
      db,
      {
        ensureProblemsLoaded: jest.fn().mockResolvedValue(problems),
      } as never,
      {
        getLinkedUsers: jest.fn().mockResolvedValue([]),
        getHistoryList: jest.fn().mockResolvedValue([]),
        getSolvedProblems: jest.fn().mockResolvedValue([]),
      } as never
    );

    await service.setSubscription(
      "guild-1",
      "channel-1",
      9,
      0,
      0,
      [{ min: 800, max: 1400 }],
      "",
      "role-2"
    );
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    const first = await service.sendManualReminder("guild-1", client, false);
    expect(first.status).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      content: "<@&role-2>",
      allowedMentions: { roles: ["role-2"] },
      embeds: expect.any(Array),
    });

    const second = await service.sendManualReminder("guild-1", client, false);
    expect(second.status).toBe("already_sent");
  });

  it("builds a preview when configured", async () => {
    const nowMs = Date.UTC(2024, 0, 1, 8, 0, 0);
    jest.useFakeTimers().setSystemTime(new Date(nowMs));

    const problems = [
      {
        contestId: 300,
        index: "C",
        name: "Sample",
        rating: 1500,
        tags: ["math"],
      },
    ];

    const service = new PracticeReminderService(
      db,
      {
        ensureProblemsLoaded: jest.fn().mockResolvedValue(problems),
      } as never,
      {
        getLinkedUsers: jest.fn().mockResolvedValue([]),
        getHistoryList: jest.fn().mockResolvedValue([]),
        getSolvedProblems: jest.fn().mockResolvedValue([]),
      } as never
    );

    await service.setSubscription(
      "guild-1",
      "channel-1",
      9,
      0,
      0,
      [{ min: 1500, max: 1500 }],
      "",
      null
    );

    const preview = await service.getPreview("guild-1");

    expect(preview?.problem?.contestId).toBe(300);
    expect(preview?.nextScheduledAt).toBeGreaterThan(0);
  });
});
