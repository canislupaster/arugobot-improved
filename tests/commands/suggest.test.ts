import { parseHandles } from "../../src/commands/suggest.js";

describe("parseHandles", () => {
  it("splits by comma and whitespace", () => {
    const result = parseHandles("tourist,  petr\nneal  tourist");
    expect(result).toEqual(["tourist", "petr", "neal"]);
  });

  it("returns empty array when no handles", () => {
    const result = parseHandles("   ,,, ");
    expect(result).toEqual([]);
  });
});
