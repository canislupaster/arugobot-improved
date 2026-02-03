import { randomUUID } from "node:crypto";

import { EmbedBuilder, type Client, type Message } from "discord.js";
import { type Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import { buildProblemUrl } from "../utils/problemReference.js";
import { formatTime, getRatingChanges } from "../utils/rating.js";
import { formatStreakEmojis } from "../utils/streaks.js";

import type { CodeforcesClient } from "./codeforces.js";
import type { StoreService } from "./store.js";

export type ChallengeStatus = "active" | "completed" | "cancelled";

export type ChallengeProblem = {
  contestId: number;
  index: string;
  name: string;
  rating: number;
};

export type ChallengeParticipant = {
  userId: string;
  position: number;
  solvedAt: number | null;
  ratingBefore: number | null;
  ratingDelta: number | null;
};

export type ActiveChallenge = {
  id: string;
  serverId: string;
  channelId: string;
  messageId: string;
  hostUserId: string;
  problem: ChallengeProblem;
  lengthMinutes: number;
  startedAt: number;
  endsAt: number;
  status: ChallengeStatus;
  checkIndex: number;
  participants: ChallengeParticipant[];
};

export type ActiveChallengeSummary = {
  id: string;
  channelId: string;
  problem: ChallengeProblem;
  endsAt: number;
};

export type ChallengeCompletionNotifier = {
  onChallengeCompleted: (challengeId: string) => Promise<void>;
};

export type CompletedChallengeParticipant = {
  userId: string;
  solvedAt: number | null;
  ratingDelta: number | null;
};

export type CompletedChallengeSummary = {
  id: string;
  serverId: string;
  channelId: string;
  hostUserId: string;
  problem: ChallengeProblem;
  startedAt: number;
  endsAt: number;
  completedAt: number | null;
  participants: CompletedChallengeParticipant[];
};

type ChallengeClock = {
  nowSeconds: () => number;
};

type ContestStatusResponse = Array<{
  verdict?: string;
  creationTimeSeconds: number;
  contestId?: number;
  problem: {
    contestId: number;
    index: string;
  };
}>;

const UPDATE_INTERVAL_SECONDS = 30;

function buildProblemLink(problem: ChallengeProblem): string {
  return `[${problem.index}. ${problem.name}](${buildProblemUrl(
    problem.contestId,
    problem.index
  )})`;
}

function parseIsoToSeconds(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.floor(timestamp / 1000);
}

function groupChallengeParticipants<Row extends { challenge_id: string }, Participant>(
  rows: Row[],
  build: (row: Row) => Participant
): Map<string, Participant[]> {
  const grouped = new Map<string, Participant[]>();
  for (const row of rows) {
    const list = grouped.get(row.challenge_id) ?? [];
    list.push(build(row));
    grouped.set(row.challenge_id, list);
  }
  return grouped;
}

function pickNextUnsolved(
  participants: ChallengeParticipant[],
  startIndex: number
): ChallengeParticipant | null {
  if (participants.length === 0) {
    return null;
  }
  for (let offset = 0; offset < participants.length; offset += 1) {
    const index = (startIndex + offset) % participants.length;
    const participant = participants[index];
    if (participant && participant.solvedAt === null) {
      return participant;
    }
  }
  return null;
}

async function fetchMessage(
  client: Client,
  channelId: string,
  messageId: string
): Promise<Message | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return null;
    }
    const message = await channel.messages.fetch(messageId);
    return message;
  } catch {
    return null;
  }
}

export class ChallengeService {
  private lastTickAt: string | null = null;
  private lastError: { message: string; timestamp: string } | null = null;

  constructor(
    private db: Kysely<Database>,
    private store: StoreService,
    private codeforces: CodeforcesClient,
    private clock: ChallengeClock = {
      nowSeconds: () => Math.floor(Date.now() / 1000),
    },
    private completionNotifier?: ChallengeCompletionNotifier
  ) {}

  setCompletionNotifier(notifier?: ChallengeCompletionNotifier): void {
    this.completionNotifier = notifier;
  }

  getLastTickAt(): string | null {
    return this.lastTickAt;
  }

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async getActiveCount(): Promise<number> {
    const row = await this.db
      .selectFrom("challenges")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("status", "=", "active")
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  async getActiveCountForServer(serverId: string): Promise<number> {
    const row = await this.db
      .selectFrom("challenges")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("server_id", "=", serverId)
      .where("status", "=", "active")
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  async getActiveChallengesForUsers(
    serverId: string,
    userIds: string[]
  ): Promise<Map<string, ActiveChallengeSummary>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .selectFrom("challenge_participants")
      .innerJoin("challenges", "challenges.id", "challenge_participants.challenge_id")
      .select((eb) => [
        eb.ref("challenge_participants.user_id").as("user_id"),
        eb.ref("challenges.id").as("challenge_id"),
        eb.ref("challenges.channel_id").as("channel_id"),
        eb.ref("challenges.problem_contest_id").as("problem_contest_id"),
        eb.ref("challenges.problem_index").as("problem_index"),
        eb.ref("challenges.problem_name").as("problem_name"),
        eb.ref("challenges.problem_rating").as("problem_rating"),
        eb.ref("challenges.ends_at").as("ends_at"),
      ])
      .where("challenges.server_id", "=", serverId)
      .where("challenges.status", "=", "active")
      .where("challenge_participants.user_id", "in", userIds)
      .execute();

    const result = new Map<string, ActiveChallengeSummary>();
    for (const row of rows) {
      if (result.has(row.user_id)) {
        continue;
      }
      result.set(row.user_id, {
        id: row.challenge_id,
        channelId: row.channel_id,
        problem: {
          contestId: row.problem_contest_id,
          index: row.problem_index,
          name: row.problem_name,
          rating: row.problem_rating,
        },
        endsAt: row.ends_at,
      });
    }
    return result;
  }

  async listActiveChallenges(serverId: string): Promise<ActiveChallenge[]> {
    return this.getActiveChallenges(serverId);
  }

  async listActiveChallengesForUser(serverId: string, userId: string): Promise<ActiveChallenge[]> {
    const challenges = await this.getActiveChallenges(serverId);
    return challenges.filter((challenge) =>
      challenge.participants.some((participant) => participant.userId === userId)
    );
  }

  async listRecentCompletedChallenges(
    serverId: string,
    limit = 5
  ): Promise<CompletedChallengeSummary[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = await this.db
      .selectFrom("challenges")
      .select([
        "id",
        "server_id",
        "channel_id",
        "host_user_id",
        "problem_contest_id",
        "problem_index",
        "problem_name",
        "problem_rating",
        "started_at",
        "ends_at",
        "updated_at",
      ])
      .where("server_id", "=", serverId)
      .where("status", "=", "completed")
      .orderBy("updated_at", "desc")
      .limit(safeLimit)
      .execute();

    if (rows.length === 0) {
      return [];
    }

    const participants = await this.db
      .selectFrom("challenge_participants")
      .select(["challenge_id", "user_id", "solved_at", "rating_delta"])
      .where(
        "challenge_id",
        "in",
        rows.map((row) => row.id)
      )
      .execute();

    const grouped = groupChallengeParticipants(participants, (participant) => ({
      userId: participant.user_id,
      solvedAt: participant.solved_at ?? null,
      ratingDelta: participant.rating_delta ?? null,
    }));

    return rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      channelId: row.channel_id,
      hostUserId: row.host_user_id,
      problem: {
        contestId: row.problem_contest_id,
        index: row.problem_index,
        name: row.problem_name,
        rating: row.problem_rating,
      },
      startedAt: row.started_at,
      endsAt: row.ends_at,
      completedAt: parseIsoToSeconds(row.updated_at),
      participants: grouped.get(row.id) ?? [],
    }));
  }

  async createChallenge({
    serverId,
    channelId,
    messageId,
    hostUserId,
    problem,
    lengthMinutes,
    participants,
    startedAt,
  }: {
    serverId: string;
    channelId: string;
    messageId: string;
    hostUserId: string;
    problem: ChallengeProblem;
    lengthMinutes: number;
    participants: string[];
    startedAt: number;
  }): Promise<string> {
    const id = randomUUID();
    const endsAt = startedAt + lengthMinutes * 60;
    const participantRatings = await Promise.all(
      participants.map(async (userId) => ({
        userId,
        rating: await this.store.getRating(serverId, userId),
      }))
    );
    for (const entry of participantRatings) {
      if (entry.rating < 0) {
        logWarn("Missing rating while creating challenge.", {
          guildId: serverId,
          userId: entry.userId,
        });
      }
    }
    const ratingMap = new Map(participantRatings.map((entry) => [entry.userId, entry.rating]));
    const nowIso = new Date().toISOString();

    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("challenges")
        .values({
          id,
          server_id: serverId,
          channel_id: channelId,
          message_id: messageId,
          host_user_id: hostUserId,
          problem_contest_id: problem.contestId,
          problem_index: problem.index,
          problem_name: problem.name,
          problem_rating: problem.rating,
          length_minutes: lengthMinutes,
          status: "active",
          started_at: startedAt,
          ends_at: endsAt,
          check_index: 0,
          updated_at: nowIso,
        })
        .execute();

      const rows = participants.map((userId, position) => ({
        challenge_id: id,
        user_id: userId,
        position,
        solved_at: null,
        rating_before: ratingMap.get(userId) ?? null,
        rating_delta: null,
        updated_at: nowIso,
      }));
      await trx.insertInto("challenge_participants").values(rows).execute();
    });

    for (const userId of participants) {
      await this.store.addToHistory(serverId, userId, `${problem.contestId}${problem.index}`);
    }

    logInfo("Challenge created.", { challengeId: id, guildId: serverId });
    return id;
  }

  async runTick(client: Client): Promise<void> {
    const nowSeconds = this.clock.nowSeconds();
    this.lastTickAt = new Date().toISOString();

    let challenges: ActiveChallenge[] = [];
    try {
      challenges = await this.getActiveChallenges();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError("Failed to load challenges.", { error: message });
      return;
    }

    if (challenges.length > 0) {
      logInfo("Processing challenge tick.", { activeChallenges: challenges.length });
    }

    for (const challenge of challenges) {
      const logContext = { challengeId: challenge.id, guildId: challenge.serverId };
      try {
        const allSolved = challenge.participants.every(
          (participant) => participant.solvedAt !== null
        );
        if (allSolved || nowSeconds >= challenge.endsAt) {
          await this.finalizeChallenge(challenge, client);
          continue;
        }

        const streakUpdates = await this.checkOneParticipant(challenge);
        await this.updateChallengeMessage(challenge, client, nowSeconds, streakUpdates);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = { message, timestamp: new Date().toISOString() };
        logError("Challenge tick failed.", { ...logContext, error: message });
      }
    }
  }

  async buildActiveEmbed({
    serverId,
    problem,
    lengthMinutes,
    timeLeftSeconds,
    participants,
    streakUpdates,
  }: {
    serverId: string;
    problem: ChallengeProblem;
    lengthMinutes: number;
    timeLeftSeconds: number;
    participants: ChallengeParticipant[];
    streakUpdates?: string[];
  }): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setTitle("Challenge")
      .setColor(EMBED_COLORS.info)
      .addFields(
        { name: "Time", value: formatTime(Math.max(0, timeLeftSeconds)), inline: false },
        { name: "Problem", value: buildProblemLink(problem), inline: false }
      );

    const ratings = await this.getRatings(serverId, participants);
    const usersValue = this.formatParticipantList(participants, ratings, (participant, rating) => {
      if (participant.solvedAt !== null) {
        return `- <@${participant.userId}> (${rating}) :white_check_mark:`;
      }
      const [down, up] = getRatingChanges(rating, problem.rating, lengthMinutes);
      return `- <@${participant.userId}> (${rating}) (don't solve: ${down}, solve: ${up}) :hourglass:`;
    });
    embed.addFields({ name: "Users", value: usersValue, inline: false });
    if (streakUpdates && streakUpdates.length > 0) {
      embed.addFields({ name: "Streaks", value: streakUpdates.join("\n"), inline: false });
    }
    return embed;
  }

  async buildResultsEmbed({
    challengeId,
    serverId,
    problem,
    participants,
    startedAt,
  }: {
    challengeId: string;
    serverId: string;
    problem: ChallengeProblem;
    participants: ChallengeParticipant[];
    startedAt: number;
  }): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setTitle("Challenge results")
      .setColor(EMBED_COLORS.info)
      .addFields({ name: "Problem", value: buildProblemLink(problem), inline: false });

    const ratings = await this.getRatings(serverId, participants);
    const usersValue = this.formatParticipantList(participants, ratings, (participant, rating) => {
      const delta =
        participant.ratingDelta === null || participant.ratingDelta === undefined
          ? "N/A"
          : participant.ratingDelta > 0
            ? `+${participant.ratingDelta}`
            : String(participant.ratingDelta);
      if (participant.solvedAt !== null) {
        const duration = formatTime(Math.max(0, participant.solvedAt - startedAt));
        return `- <@${participant.userId}> (${rating}, ${delta}) solved in ${duration} :white_check_mark:`;
      }
      return `- <@${participant.userId}> (${rating}, ${delta}) not solved :x:`;
    });

    embed.addFields({ name: "Users", value: usersValue, inline: false });

    const streakUpdates = await this.buildStreakUpdates(serverId, challengeId, participants);
    if (streakUpdates.length > 0) {
      embed.addFields({ name: "Streaks", value: streakUpdates.join("\n"), inline: false });
    }
    return embed;
  }

  async cancelChallenge(
    challengeId: string,
    cancelledBy: string,
    client: Client
  ): Promise<boolean> {
    const challenge = await this.getActiveChallengeById(challengeId);
    if (!challenge) {
      return false;
    }

    await this.db
      .updateTable("challenges")
      .set({ status: "cancelled", updated_at: new Date().toISOString() })
      .where("id", "=", challenge.id)
      .execute();

    const embed = await this.buildCancelledEmbed({
      serverId: challenge.serverId,
      problem: challenge.problem,
      participants: challenge.participants,
      cancelledBy,
    });
    const message = await fetchMessage(client, challenge.channelId, challenge.messageId);
    if (!message) {
      logWarn("Challenge message missing; skipping cancel update.", {
        challengeId: challenge.id,
        guildId: challenge.serverId,
      });
      return true;
    }
    await message.edit({ embeds: [embed] });
    logInfo("Challenge cancelled.", { challengeId: challenge.id, guildId: challenge.serverId });
    return true;
  }

  private async getActiveChallenges(serverId?: string): Promise<ActiveChallenge[]> {
    let query = this.db.selectFrom("challenges").selectAll().where("status", "=", "active");
    if (serverId) {
      query = query.where("server_id", "=", serverId);
    }
    const rows = await query.execute();
    if (rows.length === 0) {
      return [];
    }
    const participants = await this.db
      .selectFrom("challenge_participants")
      .selectAll()
      .where(
        "challenge_id",
        "in",
        rows.map((row) => row.id)
      )
      .execute();

    const grouped = groupChallengeParticipants(participants, (participant) => ({
      userId: participant.user_id,
      position: participant.position,
      solvedAt: participant.solved_at ?? null,
      ratingBefore: participant.rating_before ?? null,
      ratingDelta: participant.rating_delta ?? null,
    }));

    return rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      hostUserId: row.host_user_id,
      problem: {
        contestId: row.problem_contest_id,
        index: row.problem_index,
        name: row.problem_name,
        rating: row.problem_rating,
      },
      lengthMinutes: row.length_minutes,
      status: row.status as ChallengeStatus,
      startedAt: row.started_at,
      endsAt: row.ends_at,
      checkIndex: row.check_index,
      participants: (grouped.get(row.id) ?? []).sort((a, b) => a.position - b.position),
    }));
  }

  private async getActiveChallengeById(challengeId: string): Promise<ActiveChallenge | null> {
    const challenges = await this.getActiveChallenges();
    return challenges.find((challenge) => challenge.id === challengeId) ?? null;
  }

  private async updateChallengeMessage(
    challenge: ActiveChallenge,
    client: Client,
    nowSeconds: number,
    streakUpdates: string[] = []
  ): Promise<void> {
    const timeLeftSeconds = Math.max(0, challenge.endsAt - nowSeconds);
    const embed = await this.buildActiveEmbed({
      serverId: challenge.serverId,
      problem: challenge.problem,
      lengthMinutes: challenge.lengthMinutes,
      timeLeftSeconds,
      participants: challenge.participants,
      streakUpdates,
    });
    const message = await fetchMessage(client, challenge.channelId, challenge.messageId);
    if (!message) {
      logWarn("Challenge message missing; skipping update.", {
        challengeId: challenge.id,
        guildId: challenge.serverId,
      });
      return;
    }
    await message.edit({ embeds: [embed] });
  }

  private async checkOneParticipant(challenge: ActiveChallenge): Promise<string[]> {
    const candidate = pickNextUnsolved(challenge.participants, challenge.checkIndex);
    const nextIndex = (challenge.checkIndex + 1) % Math.max(challenge.participants.length, 1);
    await this.db
      .updateTable("challenges")
      .set({ check_index: nextIndex, updated_at: new Date().toISOString() })
      .where("id", "=", challenge.id)
      .execute();

    if (!candidate) {
      return [];
    }

    const solved = await this.checkSolve(challenge, candidate);
    if (!solved) {
      return [];
    }
    candidate.solvedAt = this.clock.nowSeconds();
    const update = await this.buildStreakUpdateForParticipant(
      challenge.serverId,
      challenge.id,
      candidate.userId
    );
    return update ? [update] : [];
  }

  private async checkSolve(
    challenge: ActiveChallenge,
    participant: ChallengeParticipant
  ): Promise<boolean> {
    const handle = await this.store.getHandle(challenge.serverId, participant.userId);
    if (!handle) {
      logWarn("Missing handle for challenge participant.", {
        challengeId: challenge.id,
        userId: participant.userId,
      });
      return false;
    }
    const status = await this.getSubmissionStatus(
      challenge.problem.contestId,
      challenge.problem.index,
      handle,
      challenge.lengthMinutes,
      challenge.startedAt
    );
    if (status !== "ok") {
      return false;
    }

    await this.markSolved(challenge, participant);
    return true;
  }

  private async markSolved(
    challenge: ActiveChallenge,
    participant: ChallengeParticipant
  ): Promise<void> {
    const nowSeconds = this.clock.nowSeconds();
    const rating = await this.store.getRating(challenge.serverId, participant.userId);
    if (rating < 0) {
      logWarn("Missing rating while resolving challenge.", {
        challengeId: challenge.id,
        guildId: challenge.serverId,
        userId: participant.userId,
      });
      await this.db
        .updateTable("challenge_participants")
        .set({ solved_at: nowSeconds, updated_at: new Date().toISOString() })
        .where("challenge_id", "=", challenge.id)
        .where("user_id", "=", participant.userId)
        .execute();
      return;
    }

    const [, up] = getRatingChanges(rating, challenge.problem.rating, challenge.lengthMinutes);
    await this.db
      .updateTable("challenge_participants")
      .set({
        solved_at: nowSeconds,
        rating_delta: up,
        updated_at: new Date().toISOString(),
      })
      .where("challenge_id", "=", challenge.id)
      .where("user_id", "=", participant.userId)
      .execute();

    participant.ratingDelta = up;
    await this.store.updateRating(challenge.serverId, participant.userId, rating + up);
  }

  private async finalizeChallenge(challenge: ActiveChallenge, client: Client): Promise<void> {
    const nowSeconds = this.clock.nowSeconds();
    const participants = challenge.participants;
    let hasPending = false;
    let hasError = false;
    const unresolvedParticipants: ChallengeParticipant[] = [];

    for (const participant of participants) {
      if (participant.solvedAt !== null) {
        continue;
      }
      const status = await this.getSubmissionStatus(
        challenge.problem.contestId,
        challenge.problem.index,
        await this.store.getHandle(challenge.serverId, participant.userId),
        challenge.lengthMinutes,
        challenge.startedAt
      );
      if (status === "ok") {
        await this.markSolved(challenge, participant);
        participant.solvedAt = nowSeconds;
        continue;
      }
      if (status === "pending") {
        hasPending = true;
        continue;
      }
      if (status === "error") {
        hasError = true;
        continue;
      }
      unresolvedParticipants.push(participant);
    }

    if (hasPending || hasError) {
      logInfo("Challenge finalization delayed.", {
        challengeId: challenge.id,
        guildId: challenge.serverId,
        pending: hasPending,
        error: hasError,
      });
      return;
    }

    for (const participant of unresolvedParticipants) {
      const rating = await this.store.getRating(challenge.serverId, participant.userId);
      if (rating < 0) {
        logWarn("Missing rating while applying challenge penalty.", {
          challengeId: challenge.id,
          guildId: challenge.serverId,
          userId: participant.userId,
        });
        continue;
      }
      const [down] = getRatingChanges(rating, challenge.problem.rating, challenge.lengthMinutes);
      await this.db
        .updateTable("challenge_participants")
        .set({ rating_delta: down, updated_at: new Date().toISOString() })
        .where("challenge_id", "=", challenge.id)
        .where("user_id", "=", participant.userId)
        .execute();
      participant.ratingDelta = down;
      await this.store.updateRating(challenge.serverId, participant.userId, rating + down);
    }

    await this.db
      .updateTable("challenges")
      .set({ status: "completed", updated_at: new Date().toISOString() })
      .where("id", "=", challenge.id)
      .execute();

    const embed = await this.buildResultsEmbed({
      challengeId: challenge.id,
      serverId: challenge.serverId,
      problem: challenge.problem,
      participants,
      startedAt: challenge.startedAt,
    });
    const message = await fetchMessage(client, challenge.channelId, challenge.messageId);
    if (!message) {
      logWarn("Challenge message missing; skipping results update.", {
        challengeId: challenge.id,
        guildId: challenge.serverId,
      });
      return;
    }
    await message.edit({ embeds: [embed] });

    if (this.completionNotifier) {
      try {
        await this.completionNotifier.onChallengeCompleted(challenge.id);
      } catch (error) {
        logWarn("Challenge completion notifier failed.", {
          challengeId: challenge.id,
          guildId: challenge.serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async buildCancelledEmbed({
    serverId,
    problem,
    participants,
    cancelledBy,
  }: {
    serverId: string;
    problem: ChallengeProblem;
    participants: ChallengeParticipant[];
    cancelledBy: string;
  }): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setTitle("Challenge cancelled")
      .setColor(EMBED_COLORS.warning)
      .addFields(
        { name: "Problem", value: buildProblemLink(problem), inline: false },
        { name: "Cancelled by", value: `<@${cancelledBy}>`, inline: true }
      );

    const ratings = await this.getRatings(serverId, participants);
    const usersValue = this.formatParticipantList(participants, ratings, (participant, rating) =>
      participant.solvedAt !== null
        ? `- <@${participant.userId}> (${rating}) :white_check_mark:`
        : `- <@${participant.userId}> (${rating}) :x:`
    );

    embed.addFields({ name: "Users", value: usersValue, inline: false });
    return embed;
  }

  private formatParticipantList(
    participants: ChallengeParticipant[],
    ratings: Map<string, number>,
    formatLine: (participant: ChallengeParticipant, rating: number) => string
  ): string {
    const lines = participants
      .sort((a, b) => a.position - b.position)
      .map((participant) => formatLine(participant, ratings.get(participant.userId) ?? 0))
      .join("\n");
    return lines || "No participants.";
  }

  private async getSubmissionStatus(
    contestId: number,
    problemIndex: string,
    handle: string | null,
    lengthMinutes: number,
    startTime: number
  ): Promise<"ok" | "pending" | "none" | "error"> {
    if (!handle) {
      return "none";
    }
    try {
      const response = await this.codeforces.request<ContestStatusResponse>("contest.status", {
        contestId,
        handle,
        from: 1,
        count: 100,
      });
      let hasPending = false;
      for (const item of response) {
        const itemContestId = item.problem.contestId ?? item.contestId ?? contestId;
        const id = `${itemContestId}${item.problem.index}`;
        if (
          id === `${contestId}${problemIndex}` &&
          item.creationTimeSeconds <= startTime + lengthMinutes * 60 &&
          item.creationTimeSeconds >= startTime
        ) {
          if (item.verdict === "OK") {
            return "ok";
          }
          if (!item.verdict || item.verdict === "TESTING") {
            hasPending = true;
          }
        }
      }
      return hasPending ? "pending" : "none";
    } catch (error) {
      logError(`Error during challenge check: ${String(error)}`, {
        contestId,
        handle,
      });
      return "error";
    }
  }

  private async buildStreakUpdates(
    serverId: string,
    challengeId: string,
    participants: ChallengeParticipant[]
  ): Promise<string[]> {
    const solvedParticipants = participants.filter((participant) => participant.solvedAt !== null);
    if (solvedParticipants.length === 0) {
      return [];
    }
    const updates: string[] = [];
    for (const participant of solvedParticipants) {
      const update = await this.buildStreakUpdateForParticipant(
        serverId,
        challengeId,
        participant.userId
      );
      if (update) {
        updates.push(update);
      }
    }
    return updates;
  }

  private async buildStreakUpdateForParticipant(
    serverId: string,
    challengeId: string,
    userId: string
  ): Promise<string | null> {
    const nowMs = this.clock.nowSeconds() * 1000;
    const before = await this.store.getChallengeStreak(serverId, userId, nowMs, challengeId);
    const after = await this.store.getChallengeStreak(serverId, userId, nowMs);
    if (after.currentStreak <= before.currentStreak) {
      return null;
    }
    const emojis = formatStreakEmojis(after.currentStreak);
    const newBest =
      after.longestStreak > before.longestStreak && after.currentStreak === after.longestStreak;
    return `- <@${userId}> streak now ${after.currentStreak} days${
      emojis ? ` ${emojis}` : ""
    }${newBest ? " (new best!)" : ""}`;
  }

  private async getRatings(
    serverId: string,
    participants: ChallengeParticipant[]
  ): Promise<Map<string, number>> {
    const ratings = await Promise.all(
      participants.map(async (participant) => ({
        userId: participant.userId,
        rating: await this.store.getRating(serverId, participant.userId),
      }))
    );
    return new Map(ratings.map((entry) => [entry.userId, entry.rating]));
  }
}

export const challengeUpdateIntervalMs = UPDATE_INTERVAL_SECONDS * 1000;
