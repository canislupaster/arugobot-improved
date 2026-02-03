import { AttachmentBuilder, EmbedBuilder, type Client } from "discord.js";
import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import {
  buildChannelServiceError,
  getSendableChannelStatusOrWarn,
} from "../utils/discordChannels.js";
import { EMBED_COLORS } from "../utils/embedColors.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import { buildRoleMentionOptions } from "../utils/mentions.js";
import { formatTime } from "../utils/rating.js";
import { capitalize } from "../utils/text.js";
import {
  formatRatingRanges,
  formatTags,
  formatTournamentRecapMarkdown,
} from "../utils/tournamentRecap.js";

import type { TournamentRecap, TournamentService } from "./tournaments.js";

const STANDINGS_PREVIEW_LIMIT = 5;

export type TournamentRecapSettings = {
  guildId: string;
  channelId: string;
  roleId: string | null;
};

export type TournamentRecapPostResult =
  | { status: "no_subscription" }
  | { status: "no_completed" }
  | { status: "recap_missing"; tournamentId: string }
  | { status: "channel_missing"; channelId: string }
  | { status: "channel_missing_permissions"; channelId: string; missingPermissions: string[] }
  | { status: "sent"; channelId: string; tournamentId: string }
  | { status: "error"; message: string };

type TournamentRecapProvider = Pick<TournamentService, "getRecap">;

function buildRecapEmbed(recap: TournamentRecap): EmbedBuilder {
  const winnerLabel = recap.entry.winnerId ? `<@${recap.entry.winnerId}>` : "None";
  const formatLabel = capitalize(recap.entry.format);
  const statusLabel = recap.entry.status === "completed" ? "Completed" : "Cancelled";
  const updatedLabel = recap.entry.updatedAt;
  const embed = new EmbedBuilder()
    .setTitle("Tournament recap")
    .setColor(EMBED_COLORS.info)
    .setDescription(`${statusLabel} • ${formatLabel} • ${recap.entry.lengthMinutes}m`)
    .addFields(
      { name: "Participants", value: String(recap.entry.participantCount), inline: true },
      { name: "Rounds", value: String(recap.entry.roundCount), inline: true },
      { name: "Winner", value: winnerLabel, inline: true },
      { name: "Updated", value: updatedLabel, inline: true }
    )
    .setFooter({
      text: `Ranges: ${formatRatingRanges(recap.entry.ratingRanges)} • Tags: ${formatTags(
        recap.entry.tags
      )}`,
    });

  if (recap.standings.length > 0) {
    const standingsValue = recap.standings
      .slice(0, STANDINGS_PREVIEW_LIMIT)
      .map((participant, index) => {
        const tiebreak =
          recap.entry.format === "swiss"
            ? ` • TB ${participant.tiebreak.toFixed(1)}`
            : recap.entry.format === "arena"
              ? ` • ${formatTime(participant.tiebreak)}`
              : "";
        const status = participant.eliminated ? " • eliminated" : "";
        if (recap.entry.format === "arena") {
          return `${index + 1}. <@${participant.userId}> • ${participant.score} solves${tiebreak}`;
        }
        return `${index + 1}. <@${participant.userId}> • ${participant.score} pts (${participant.wins}-${participant.losses}-${participant.draws})${tiebreak}${status}`;
      })
      .join("\n");
    embed.addFields({
      name: `Standings (top ${Math.min(STANDINGS_PREVIEW_LIMIT, recap.standings.length)})`,
      value: standingsValue,
      inline: false,
    });
  }

  if (recap.entry.format === "arena" && recap.arenaProblems?.length) {
    const problemLines = recap.arenaProblems
      .map((problem) => `${problem.contestId}${problem.index} • ${problem.name}`)
      .join("\n");
    embed.addFields({ name: "Problems", value: problemLines, inline: false });
  }

  return embed;
}

export class TournamentRecapService {
  private lastError: { message: string; timestamp: string } | null = null;

  constructor(
    private db: Kysely<Database>,
    private tournaments: TournamentRecapProvider
  ) {}

  getLastError(): { message: string; timestamp: string } | null {
    return this.lastError;
  }

  async getSubscription(guildId: string): Promise<TournamentRecapSettings | null> {
    const row = await this.db
      .selectFrom("tournament_recap_settings")
      .select(["guild_id", "channel_id", "role_id"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    return {
      guildId: row.guild_id,
      channelId: row.channel_id,
      roleId: row.role_id ?? null,
    };
  }

  async getSubscriptionCount(): Promise<number> {
    const row = await this.db
      .selectFrom("tournament_recap_settings")
      .select(({ fn }) => fn.count<number>("guild_id").as("count"))
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  async setSubscription(guildId: string, channelId: string, roleId: string | null): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.db
      .insertInto("tournament_recap_settings")
      .values({
        guild_id: guildId,
        channel_id: channelId,
        role_id: roleId,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict((oc) =>
        oc.column("guild_id").doUpdateSet({
          channel_id: channelId,
          role_id: roleId,
          updated_at: timestamp,
        })
      )
      .execute();
  }

  async clearSubscription(guildId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("tournament_recap_settings")
      .where("guild_id", "=", guildId)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0) > 0;
  }

  async postLatestCompletedRecap(
    guildId: string,
    client: Client
  ): Promise<TournamentRecapPostResult> {
    const subscription = await this.getSubscription(guildId);
    if (!subscription) {
      return { status: "no_subscription" };
    }
    const row = await this.db
      .selectFrom("tournaments")
      .select(["id"])
      .where("guild_id", "=", guildId)
      .where("status", "=", "completed")
      .orderBy("updated_at", "desc")
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      return { status: "no_completed" };
    }
    return this.postRecap(subscription, row.id, client, false);
  }

  async postRecapForTournament(
    guildId: string,
    tournamentId: string,
    client: Client,
    isAutomatic: boolean
  ): Promise<TournamentRecapPostResult> {
    const subscription = await this.getSubscription(guildId);
    if (!subscription) {
      return { status: "no_subscription" };
    }
    return this.postRecap(subscription, tournamentId, client, isAutomatic);
  }

  private async postRecap(
    subscription: TournamentRecapSettings,
    tournamentId: string,
    client: Client,
    isAutomatic: boolean
  ): Promise<TournamentRecapPostResult> {
    const recap = await this.tournaments.getRecap(subscription.guildId, tournamentId);
    if (!recap) {
      logWarn("Tournament recap missing.", { guildId: subscription.guildId, tournamentId });
      return { status: "recap_missing", tournamentId };
    }

    const channelStatus = await getSendableChannelStatusOrWarn(
      client,
      subscription.channelId,
      "Tournament recap channel missing or invalid.",
      {
        guildId: subscription.guildId,
        channelId: subscription.channelId,
        tournamentId,
      }
    );
    if (channelStatus.status !== "ok") {
      this.lastError =
        buildChannelServiceError(
          "Tournament recap",
          subscription.channelId,
          channelStatus
        ) ?? this.lastError;
      if (channelStatus.status === "missing_permissions") {
        return {
          status: "channel_missing_permissions",
          channelId: subscription.channelId,
          missingPermissions: channelStatus.missingPermissions,
        };
      }
      return { status: "channel_missing", channelId: subscription.channelId };
    }
    const channel = channelStatus.channel;

    const embed = buildRecapEmbed(recap);
    const markdown = formatTournamentRecapMarkdown(recap);
    const filename = `tournament-recap-${tournamentId.slice(0, 8)}.md`;
    const file = new AttachmentBuilder(Buffer.from(markdown, "utf8"), { name: filename });
    const { mention, allowedMentions } = buildRoleMentionOptions(subscription.roleId);

    try {
      await channel.send({
        content: mention,
        allowedMentions,
        embeds: [embed],
        files: [file],
      });
      logInfo("Tournament recap sent.", {
        guildId: subscription.guildId,
        channelId: subscription.channelId,
        tournamentId,
        autoPosted: isAutomatic,
      });
      return { status: "sent", channelId: subscription.channelId, tournamentId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { message, timestamp: new Date().toISOString() };
      logError("Failed to post tournament recap.", {
        error: message,
        guildId: subscription.guildId,
        channelId: subscription.channelId,
        tournamentId,
      });
      return { status: "error", message };
    }
  }
}
