import { buildRoleMention, buildRoleMentionOptions } from "../../src/utils/mentions.js";

describe("mentions helpers", () => {
  it("returns no mention options when role id is missing", () => {
    const result = buildRoleMentionOptions(null);

    expect(result.mention).toBeUndefined();
    expect(result.allowedMentions).toEqual({ parse: [] });
  });

  it("builds a role mention payload when role id is provided", () => {
    const result = buildRoleMentionOptions("role-1");

    expect(buildRoleMention("role-1")).toBe("<@&role-1>");
    expect(result.mention).toBe("<@&role-1>");
    expect(result.allowedMentions).toEqual({ roles: ["role-1"] });
  });
});
