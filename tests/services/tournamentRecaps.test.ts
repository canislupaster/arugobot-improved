import { ChannelType, type Client } from "discord.js";
import { Kysely } from "kysely";

import { createDb } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";
import type { Database } from "../../src/db/types.js";
import { TournamentRecapService } from "../../src/services/tournamentRecaps.js";
import type { TournamentRecap, TournamentService } from "../../src/services/tournaments.js";

const createMockClient = (
  send: jest.Mock,
  channelType = ChannelType.GuildText,
  permissions: { has: jest.Mock } | null = { has: jest.fn().mockReturnValue(true) }
) =>
  ({
    user: { id: "bot-1" },
    channels: {
      fetch: jest.fn().mockResolvedValue({
        type: channelType,
        send,
        permissionsFor: jest.fn().mockReturnValue(permissions),
      }),
    },
  }) as unknown as Client;

const buildRecap = (): TournamentRecap => ({
  entry: {
    id: "tournament-1",
    format: "swiss",
    status: "completed",
    lengthMinutes: 40,
    roundCount: 3,
    ratingRanges: [],
    tags: "",
    createdAt: "2026-01-24T10:00:00.000Z",
    updatedAt: "2026-01-24T12:00:00.000Z",
    participantCount: 2,
    winnerId: "user-1",
  },
  channelId: "channel-1",
  hostUserId: "host-1",
  standings: [
    {
      userId: "user-1",
      seed: 1,
      score: 3,
      wins: 3,
      losses: 0,
      draws: 0,
      eliminated: false,
      tiebreak: 2.5,
      matchesPlayed: 3,
    },
  ],
  rounds: [],
  participantHandles: { "user-1": "tourist" },
});

describe("TournamentRecapService", () => {
  let db: Kysely<Database>;
  let tournaments: jest.Mocked<Pick<TournamentService, "getRecap">>;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateToLatest(db);
    tournaments = {
      getRecap: jest.fn().mockResolvedValue(buildRecap()),
    };
  });

  afterEach(async () => {
    await db.destroy();
    jest.restoreAllMocks();
  });

  it("returns no_subscription when auto-posts are not configured", async () => {
    const service = new TournamentRecapService(db, tournaments);
    const send = jest.fn();
    const client = createMockClient(send);

    const result = await service.postLatestCompletedRecap("guild-1", client);

    expect(result.status).toBe("no_subscription");
    expect(send).not.toHaveBeenCalled();
  });

  it("posts the latest completed tournament recap", async () => {
    await db
      .insertInto("tournaments")
      .values({
        id: "tournament-1",
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "swiss",
        status: "completed",
        length_minutes: 40,
        round_count: 3,
        current_round: 3,
        rating_ranges: "[]",
        tags: "",
        created_at: "2026-01-24T10:00:00.000Z",
        updated_at: "2026-01-24T12:00:00.000Z",
      })
      .execute();

    const service = new TournamentRecapService(db, tournaments);
    await service.setSubscription("guild-1", "channel-1", null);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send);

    const result = await service.postLatestCompletedRecap("guild-1", client);

    expect(result.status).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as { embeds: Array<{ data: { title: string } }> };
    expect(payload.embeds[0]?.data.title).toBe("Tournament recap");
  });

  it("returns channel_missing when the recap channel is unavailable", async () => {
    await db
      .insertInto("tournaments")
      .values({
        id: "tournament-1",
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "swiss",
        status: "completed",
        length_minutes: 40,
        round_count: 3,
        current_round: 3,
        rating_ranges: "[]",
        tags: "",
        created_at: "2026-01-24T10:00:00.000Z",
        updated_at: "2026-01-24T12:00:00.000Z",
      })
      .execute();

    const service = new TournamentRecapService(db, tournaments);
    await service.setSubscription("guild-1", "channel-1", null);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send, ChannelType.GuildVoice);

    const result = await service.postLatestCompletedRecap("guild-1", client);

    expect(result.status).toBe("channel_missing");
    expect(send).not.toHaveBeenCalled();
    const subscription = await service.getSubscription("guild-1");
    expect(subscription).toBeNull();
  });

  it("returns channel_missing_permissions when the bot cannot post in the channel", async () => {
    await db
      .insertInto("tournaments")
      .values({
        id: "tournament-1",
        guild_id: "guild-1",
        channel_id: "channel-1",
        host_user_id: "host-1",
        format: "swiss",
        status: "completed",
        length_minutes: 40,
        round_count: 3,
        current_round: 3,
        rating_ranges: "[]",
        tags: "",
        created_at: "2026-01-24T10:00:00.000Z",
        updated_at: "2026-01-24T12:00:00.000Z",
      })
      .execute();

    const service = new TournamentRecapService(db, tournaments);
    await service.setSubscription("guild-1", "channel-1", null);
    const send = jest.fn().mockResolvedValue(undefined);
    const client = createMockClient(send, ChannelType.GuildText, {
      has: jest.fn().mockReturnValue(false),
    });

    const result = await service.postLatestCompletedRecap("guild-1", client);

    expect(result.status).toBe("channel_missing_permissions");
    expect(send).not.toHaveBeenCalled();
  });
});
