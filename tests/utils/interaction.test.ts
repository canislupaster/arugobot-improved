import { resolveTargetLabels } from "../../src/utils/interaction.js";

type FakeUser = { username: string; toString: () => string };

describe("resolveTargetLabels", () => {
  const user: FakeUser = {
    username: "Aru",
    toString: () => "<@123>",
  };

  it("uses member display name and mention when available", () => {
    const member = {
      displayName: "Nickname",
      toString: () => "<@!123>",
    };

    expect(resolveTargetLabels(user as never, member)).toEqual({
      displayName: "Nickname",
      mention: "<@!123>",
    });
  });

  it("falls back to user mention when member has no toString", () => {
    const member = { displayName: "Nickname" };

    expect(resolveTargetLabels(user as never, member)).toEqual({
      displayName: "Nickname",
      mention: "<@123>",
    });
  });

  it("falls back to username when member has no displayName", () => {
    const member = { toString: () => "<@!999>" };

    expect(resolveTargetLabels(user as never, member)).toEqual({
      displayName: "Aru",
      mention: "<@!999>",
    });
  });

  it("falls back to user when member is missing", () => {
    expect(resolveTargetLabels(user as never, null)).toEqual({
      displayName: "Aru",
      mention: "<@123>",
    });
  });
});
