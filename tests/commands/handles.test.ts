import type { ChatInputCommandInteraction } from "discord.js";

import { handlesCommand } from "../../src/commands/handles.js";
import type { CommandContext } from "../../src/types/commandContext.js";

const createInteraction = () => {
  const response = {
    createMessageComponentCollector: jest.fn().mockReturnValue({ on: jest.fn() }),
  };
  return {
    guild: {
      id: "guild-1",
      members: {
        fetch: jest.fn().mockResolvedValue(
          new Map([["user-1", { user: { id: "user-1" } }]])
        ),
        cache: new Map([["user-1", { user: { id: "user-1" } }]]),
      },
    },
    user: { id: "user-1" },
    options: {
      getInteger: jest.fn().mockReturnValue(1),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(response),
  } as unknown as ChatInputCommandInteraction;
};

describe("handlesCommand", () => {
  it("renders a paginated roster", async () => {
    const interaction = createInteraction();
    const context = {
      services: {
        store: {
          getServerRoster: jest
            .fn()
            .mockResolvedValue([
              { userId: "user-1", handle: "tourist", rating: 3500 },
              { userId: "user-2", handle: "petr", rating: 3400 },
            ]),
        },
      },
    } as unknown as CommandContext;

    await handlesCommand.execute(interaction, context);

    const payload = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe("Linked handles");
    expect(payload.embeds[0].data.fields?.[0]?.value ?? "").toContain("tourist");
    expect(payload.embeds[0].data.fields?.[0]?.value ?? "").not.toContain("petr");
    expect(payload.embeds[0].data.footer?.text ?? "").toContain("1 linked handle excluded");
    expect(payload.components).toHaveLength(1);
  });
});
