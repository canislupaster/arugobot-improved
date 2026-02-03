import {
  buildServiceError,
  buildServiceErrorFromException,
  getErrorMessage,
  getErrorMessageForLog,
  recordServiceError,
} from "../../src/utils/errors.js";

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

describe("buildServiceError", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns null when message is missing", () => {
    expect(buildServiceError()).toBeNull();
    expect(buildServiceError("")).toBeNull();
    expect(buildServiceError(null)).toBeNull();
  });

  it("builds a timestamped error when message is provided", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-02-01T00:00:00.000Z"));
    expect(buildServiceError("boom")).toEqual({
      message: "boom",
      timestamp: "2024-02-01T00:00:00.000Z",
    });
  });
});

describe("getErrorMessageForLog", () => {
  it("falls back to String when no message is found", () => {
    expect(getErrorMessageForLog({})).toBe("[object Object]");
  });
});

describe("buildServiceErrorFromException", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns a timestamped message", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-03-01T00:00:00.000Z"));
    expect(buildServiceErrorFromException("boom")).toEqual({
      message: "boom",
      timestamp: "2024-03-01T00:00:00.000Z",
    });
  });
});

describe("recordServiceError", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("records the error and returns the same entry", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-04-01T00:00:00.000Z"));
    const record = jest.fn();
    const entry = recordServiceError("boom", record);
    expect(entry).toEqual({
      message: "boom",
      timestamp: "2024-04-01T00:00:00.000Z",
    });
    expect(record).toHaveBeenCalledWith(entry);
  });
});
