import type { ChatInputCommandInteraction } from "discord.js";

import { tournamentCommand } from "../../src/commands/tournament.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = () =>
  ({
    options: {
      getSubcommand: jest.fn().mockReturnValue("status"),
    },
    guild: { id: "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChatInputCommandInteraction;

const createHistoryInteraction = () => {
  const collector = { on: jest.fn() };
  const response = {
    createMessageComponentCollector: jest.fn().mockReturnValue(collector),
  };
  return {
    options: {
      getSubcommand: jest.fn().mockReturnValue("history"),
      getInteger: jest.fn().mockReturnValue(1),
    },
    guild: { id: "guild-1" },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(response),
  } as unknown as ChatInputCommandInteraction;
};

describe("tournamentCommand", () => {
  it("shows round summaries and tiebreak standings", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        tournaments: {
          getActiveTournament: jest.fn().mockResolvedValue({
            id: "tournament-1",
            guildId: "guild-1",
            channelId: "channel-1",
            hostUserId: "host-1",
            format: "swiss",
            status: "active",
            lengthMinutes: 40,
            roundCount: 3,
            currentRound: 2,
            ratingRanges: [],
            tags: "",
          }),
          getStandings: jest.fn().mockResolvedValue([
            {
              userId: "user-1",
              seed: 1,
              score: 2,
              wins: 2,
              losses: 0,
              draws: 0,
              eliminated: false,
              tiebreak: 1.5,
              matchesPlayed: 2,
            },
            {
              userId: "user-2",
              seed: 2,
              score: 2,
              wins: 2,
              losses: 0,
              draws: 0,
              eliminated: false,
              tiebreak: 1,
              matchesPlayed: 2,
            },
          ]),
          getCurrentRound: jest.fn().mockResolvedValue({
            id: "round-2",
            roundNumber: 2,
            status: "active",
            problem: {
              contestId: 1000,
              index: "A",
              name: "Test Problem",
              rating: 1200,
              tags: [],
            },
          }),
          listRoundSummaries: jest.fn().mockResolvedValue([
            {
              roundNumber: 2,
              status: "active",
              matchCount: 2,
              completedCount: 1,
              byeCount: 0,
              problem: {
                contestId: 1000,
                index: "A",
                name: "Test Problem",
                rating: 1200,
                tags: [],
              },
            },
            {
              roundNumber: 1,
              status: "completed",
              matchCount: 2,
              completedCount: 2,
              byeCount: 0,
              problem: {
                contestId: 900,
                index: "B",
                name: "Old Problem",
                rating: 1100,
                tags: [],
              },
            },
          ]),
          listRoundMatches: jest.fn().mockResolvedValue([
            {
              matchNumber: 1,
              player1Id: "user-1",
              player2Id: "user-2",
              winnerId: null,
              status: "pending",
              isDraw: false,
            },
          ]),
        },
      },
    } as unknown as CommandContext;

    await tournamentCommand.execute(interaction, context);

    const payload = (interaction.reply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const fields = (embed.fields ?? []) as Array<{ name: string; value: string }>;
    const standingsField = fields.find((field) => field.name === "Standings (top 10)");
    expect(standingsField?.value).toContain("TB");
    const roundsField = fields.find((field) => field.name === "Recent rounds");
    expect(roundsField?.value).toContain("Round 1");
    const matchesField = fields.find((field) => field.name === "Current round matches");
    expect(matchesField?.value).toContain("vs");
  });

  it("renders tournament history entries", async () => {
    const interaction = createHistoryInteraction();
    const context = {
      services: {
        tournaments: {
          getHistoryPage: jest.fn().mockResolvedValue({
            total: 1,
            entries: [
              {
                id: "tournament-1",
                format: "swiss",
                status: "completed",
                lengthMinutes: 40,
                roundCount: 3,
                ratingRanges: [],
                tags: "",
                createdAt: "2026-01-24T10:00:00.000Z",
                updatedAt: "2026-01-24T12:00:00.000Z",
                participantCount: 8,
                winnerId: "user-1",
              },
            ],
          }),
        },
      },
    } as unknown as CommandContext;

    await tournamentCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    const embed = payload.embeds[0].data;
    const fields = (embed.fields ?? []) as Array<{ name: string; value: string }>;
    const historyField = fields.find((field) => field.name === "Recent tournaments");
    expect(historyField?.value).toContain("Winner: <@user-1>");
    expect(payload.components).toHaveLength(2);
  });
});
