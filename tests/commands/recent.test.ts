import type { ChatInputCommandInteraction } from "discord.js";

import { recentCommand } from "../../src/commands/recent.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    commandName: "recent",
    user: { id: "user-1", username: "User" },
    guild: { id: "guild-1" },
    options: {
      getUser: jest.fn().mockReturnValue(null),
      getMember: jest.fn().mockReturnValue(null),
      getInteger: jest.fn().mockReturnValue(null),
      getString: jest.fn().mockImplementation(() => null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ChatInputCommandInteraction;

describe("recentCommand", () => {
  it("replies when handle is not linked", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-1",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue(null),
        },
      },
    } as unknown as CommandContext;

    await recentCommand.execute(interaction, context);

    expect(interaction.editReply).toHaveBeenCalledWith("Handle not linked.");
  });

  it("rejects when both handle and user are provided", async () => {
    const interaction = createInteraction({
      options: {
        getUser: jest.fn().mockReturnValue({ id: "user-2", username: "Other" }),
        getMember: jest.fn().mockReturnValue(null),
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockImplementation((name: string) =>
          name === "handle" ? "tourist" : null
        ),
      },
    });
    const context = { correlationId: "corr-3", services: {} } as unknown as CommandContext;

    await recentCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Provide either a handle or a user, not both.",
    });
  });

  it("uses handle input when provided", async () => {
    const interaction = createInteraction({
      options: {
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockImplementation((name: string) =>
          name === "handle" ? "tourist" : null
        ),
      },
    });
    const context = {
      correlationId: "corr-4",
      services: {
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Tourist",
            source: "api",
          }),
          getRecentSubmissions: jest.fn().mockResolvedValue({
            submissions: [
              {
                id: 1,
                contestId: 1000,
                index: "A",
                name: "Test Problem",
                verdict: "OK",
                creationTimeSeconds: 123,
                programmingLanguage: "GNU C++17",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await recentCommand.execute(interaction, context);

    expect(context.services.store.resolveHandle).toHaveBeenCalledWith("tourist");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.fields[0].value).toBe("Tourist");
  });

  it("renders recent submissions", async () => {
    const interaction = createInteraction();
    const context = {
      correlationId: "corr-5",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue("tourist"),
          getRecentSubmissions: jest.fn().mockResolvedValue({
            submissions: [
              {
                id: 1,
                contestId: 1000,
                index: "A",
                name: "Test Problem",
                verdict: "OK",
                creationTimeSeconds: 123,
                programmingLanguage: "GNU C++17",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await recentCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toContain("Recent submissions");
  });

  it("filters submissions by result", async () => {
    const interaction = createInteraction({
      options: {
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
        getInteger: jest.fn().mockReturnValue(5),
        getString: jest.fn().mockImplementation((name: string) => {
          if (name === "result") {
            return "accepted";
          }
          return null;
        }),
      },
    });
    const context = {
      correlationId: "corr-6",
      services: {
        store: {
          getHandle: jest.fn().mockResolvedValue("tourist"),
          getRecentSubmissions: jest.fn().mockResolvedValue({
            submissions: [
              {
                id: 1,
                contestId: 1000,
                index: "A",
                name: "Accepted",
                verdict: "OK",
                creationTimeSeconds: 123,
                programmingLanguage: "GNU C++17",
              },
              {
                id: 2,
                contestId: 1000,
                index: "B",
                name: "Rejected",
                verdict: "WRONG_ANSWER",
                creationTimeSeconds: 124,
                programmingLanguage: "GNU C++17",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await recentCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.fields[1].value).toContain("Accepted");
    expect(payload.embeds[0].data.fields[1].value).not.toContain("Rejected");
  });

  it("requires a handle in DMs", async () => {
    const interaction = createInteraction({
      guild: null,
      options: {
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockImplementation(() => ""),
      },
    });
    const context = { correlationId: "corr-7", services: {} } as unknown as CommandContext;

    await recentCommand.execute(interaction, context);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Provide a handle when using this command in DMs.",
    });
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it("supports handles in DMs", async () => {
    const interaction = createInteraction({
      guild: null,
      options: {
        getUser: jest.fn().mockReturnValue(null),
        getMember: jest.fn().mockReturnValue(null),
        getInteger: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockImplementation((name: string) =>
          name === "handle" ? "tourist" : null
        ),
      },
    });
    const context = {
      correlationId: "corr-8",
      services: {
        store: {
          resolveHandle: jest.fn().mockResolvedValue({
            exists: true,
            canonicalHandle: "Tourist",
            source: "api",
          }),
          getRecentSubmissions: jest.fn().mockResolvedValue({
            submissions: [
              {
                id: 1,
                contestId: 1000,
                index: "A",
                name: "Test Problem",
                verdict: "OK",
                creationTimeSeconds: 123,
                programmingLanguage: "GNU C++17",
              },
            ],
            source: "api",
            isStale: false,
          }),
        },
      },
    } as unknown as CommandContext;

    await recentCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(context.services.store.resolveHandle).toHaveBeenCalledWith("tourist");
    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.fields[0].value).toBe("Tourist");
  });
});
