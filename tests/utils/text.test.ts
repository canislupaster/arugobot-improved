import { capitalize } from "../../src/utils/text.js";

describe("capitalize", () => {
  it("uppercases the first character", () => {
    expect(capitalize("swiss")).toBe("Swiss");
  });

  it("leaves already-capitalized strings intact", () => {
    expect(capitalize("Arena")).toBe("Arena");
  });

  it("handles empty strings", () => {
    expect(capitalize("")).toBe("");
  });
});
