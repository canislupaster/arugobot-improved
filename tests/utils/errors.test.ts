import { getErrorMessage } from "../../src/utils/errors.js";

describe("getErrorMessage", () => {
  it("returns message from Error", () => {
    const error = new Error("boom");
    expect(getErrorMessage(error)).toBe("boom");
  });

  it("returns message from string", () => {
    expect(getErrorMessage("nope")).toBe("nope");
  });

  it("returns message from object with message field", () => {
    expect(getErrorMessage({ message: "from-object" })).toBe("from-object");
  });

  it("returns empty string for unsupported input", () => {
    expect(getErrorMessage({})).toBe("");
  });
});
