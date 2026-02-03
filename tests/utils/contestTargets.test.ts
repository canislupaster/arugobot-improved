import type { Guild, User } from "discord.js";

import { getContestTargetContextError } from "../../src/utils/contestTargets.js";

describe("getContestTargetContextError", () => {
  const guild = { id: "guild" } as Guild;
  const user = { id: "user" } as User;

  it("blocks user options in DMs", () => {
    expect(
      getContestTargetContextError({
        guild: null,
        userOptions: [user],
        handleInputs: ["tourist"],
      })
    ).toBe("Specify handles directly when using this command outside a server.");
  });

  it("requires at least one handle in DMs", () => {
    expect(
      getContestTargetContextError({
        guild: null,
        userOptions: [],
        handleInputs: [],
      })
    ).toBe("Provide at least one handle or run this command in a server.");
  });

  it("allows handles in DMs", () => {
    expect(
      getContestTargetContextError({
        guild: null,
        userOptions: [],
        handleInputs: ["tourist"],
      })
    ).toBeNull();
  });

  it("allows user options in guilds", () => {
    expect(
      getContestTargetContextError({
        guild,
        userOptions: [user],
        handleInputs: [],
      })
    ).toBeNull();
  });
});
