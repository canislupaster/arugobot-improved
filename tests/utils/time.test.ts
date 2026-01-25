import {
  formatHourMinute,
  formatUtcOffset,
  parseUtcOffset,
  toLocalTime,
  toUtcTime,
} from "../../src/utils/time.js";

describe("time utils", () => {
  it("formats hour/minute pairs with zero padding", () => {
    expect(formatHourMinute(9, 0)).toBe("09:00");
  });

  it("formats UTC offsets", () => {
    expect(formatUtcOffset(0)).toBe("UTC");
    expect(formatUtcOffset(-330)).toBe("UTC-05:30");
    expect(formatUtcOffset(150)).toBe("UTC+02:30");
  });

  it("parses UTC offsets", () => {
    expect(parseUtcOffset("Z")).toEqual({ minutes: 0 });
    expect(parseUtcOffset("utc")).toEqual({ minutes: 0 });
    expect(parseUtcOffset("+02:30")).toEqual({ minutes: 150 });
  });

  it("rejects invalid UTC offsets", () => {
    expect(parseUtcOffset("+25:00")).toEqual({
      error: "UTC offset must be between -12:00 and +14:00.",
    });
    expect(parseUtcOffset("bad")).toEqual({
      error: "Invalid UTC offset. Use formats like +02:00, -05:30, or Z.",
    });
  });

  it("converts between local and UTC time using offsets", () => {
    expect(toUtcTime(9, 0, 150)).toEqual({ hour: 6, minute: 30 });
    expect(toLocalTime(6, 30, 150)).toEqual({ hour: 9, minute: 0 });
  });
});
