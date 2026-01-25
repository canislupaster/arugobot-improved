import { formatStreakEmojis } from "../../src/utils/streaks.js";

describe("formatStreakEmojis", () => {
  it("caps emoji count and ignores non-positive streaks", () => {
    expect(formatStreakEmojis(0)).toBe("");
    expect(formatStreakEmojis(-2)).toBe("");
    expect(formatStreakEmojis(2)).toBe("🔥🔥");
    expect(formatStreakEmojis(10, 5)).toBe("🔥🔥🔥🔥🔥");
  });
});
