import { capitalize, normalizeOptionalString } from "../../src/utils/text.js";

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

describe("normalizeOptionalString", () => {
  it("returns trimmed input", () => {
    expect(normalizeOptionalString("  hello ")).toBe("hello");
  });

  it("returns null for empty or whitespace input", () => {
    expect(normalizeOptionalString("")).toBeNull();
    expect(normalizeOptionalString("   ")).toBeNull();
  });

  it("returns null for nullish input", () => {
    expect(normalizeOptionalString(null)).toBeNull();
    expect(normalizeOptionalString(undefined)).toBeNull();
  });
});
