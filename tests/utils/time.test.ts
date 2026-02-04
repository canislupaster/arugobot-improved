import {
  formatHourMinute,
  formatUpdatedAt,
  formatUtcOffset,
  getLocalDayForUtcMs,
  getUtcScheduleMs,
  parseUtcOffset,
  resolveUtcOffsetMinutes,
  toLocalTime,
  toUtcTime,
  wasSentSince,
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

  it("formats updated timestamps when possible", () => {
    const value = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString();
    expect(formatUpdatedAt(value)).toBe("<t:1704067200:F>");
    expect(formatUpdatedAt("not-a-date")).toBe("not-a-date");
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

  it("resolves optional UTC offsets with defaults", () => {
    expect(resolveUtcOffsetMinutes(null)).toEqual({ minutes: 0 });
    expect(resolveUtcOffsetMinutes("")).toEqual({ minutes: 0 });
    expect(resolveUtcOffsetMinutes(" +02:30 ")).toEqual({ minutes: 150 });
    expect(resolveUtcOffsetMinutes("bad")).toEqual({
      error: "Invalid UTC offset. Use formats like +02:00, -05:30, or Z.",
    });
  });

  it("converts between local and UTC time using offsets", () => {
    expect(toUtcTime(9, 0, 150)).toEqual({ hour: 6, minute: 30 });
    expect(toLocalTime(6, 30, 150)).toEqual({ hour: 9, minute: 0 });
  });

  it("checks whether a timestamp is after a cutoff", () => {
    const cutoff = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
    expect(wasSentSince(null, cutoff)).toBe(false);
    expect(wasSentSince("invalid", cutoff)).toBe(false);
    expect(wasSentSince(new Date(cutoff - 1000).toISOString(), cutoff)).toBe(false);
    expect(wasSentSince(new Date(cutoff).toISOString(), cutoff)).toBe(true);
  });

  it("computes the local day for a UTC timestamp and offset", () => {
    const mondayUtc = Date.UTC(2024, 6, 1, 0, 0, 0, 0);
    expect(getLocalDayForUtcMs(mondayUtc, 0)).toBe(1);
    expect(getLocalDayForUtcMs(mondayUtc, 60)).toBe(1);
    expect(getLocalDayForUtcMs(mondayUtc, -60)).toBe(0);
  });

  it("computes the UTC schedule time for a date and time", () => {
    const now = new Date(Date.UTC(2024, 1, 20, 12, 34, 56, 0));
    expect(getUtcScheduleMs(now, 9, 15)).toBe(Date.UTC(2024, 1, 20, 9, 15, 0, 0));
  });
});
