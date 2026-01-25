import { normalizeHandleInput } from "../../src/utils/handles.js";

describe("normalizeHandleInput", () => {
  it("extracts a handle from a profile URL", () => {
    expect(normalizeHandleInput("https://codeforces.com/profile/tourist")).toBe("tourist");
  });

  it("extracts a handle from a short profile URL", () => {
    expect(normalizeHandleInput("https://codeforces.com/u/Petr")).toBe("Petr");
  });

  it("handles wrapped links", () => {
    expect(normalizeHandleInput("<https://codeforces.com/profile/Benq>")).toBe("Benq");
  });

  it("leaves plain handles unchanged", () => {
    expect(normalizeHandleInput("  jiangly  ")).toBe("jiangly");
  });
});
