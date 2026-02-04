import {
  formatContestScopeLabel,
  parseContestScope,
  refreshContestData,
} from "../../src/utils/contestScope.js";

describe("contestScope utils", () => {
  describe("parseContestScope", () => {
    it("returns known scope values", () => {
      expect(parseContestScope("official")).toBe("official");
      expect(parseContestScope("gym")).toBe("gym");
      expect(parseContestScope("all")).toBe("all");
    });

    it("falls back to the default scope", () => {
      expect(parseContestScope("unknown")).toBe("official");
    });

    it("uses custom fallback when provided", () => {
      expect(parseContestScope("unknown", "all")).toBe("all");
    });
  });

  describe("formatContestScopeLabel", () => {
    it("returns the display label for each scope", () => {
      expect(formatContestScopeLabel("official")).toBe("Official");
      expect(formatContestScopeLabel("gym")).toBe("Gym");
      expect(formatContestScopeLabel("all")).toBe("All");
    });
  });

  describe("refreshContestData", () => {
    it("marks stale when a scoped refresh fails but cache exists", async () => {
      const contests = {
        refresh: jest.fn().mockRejectedValue(new Error("boom")),
        getLastRefreshAt: jest.fn().mockReturnValue(123),
      };

      const result = await refreshContestData(contests, "official");

      expect("stale" in result && result.stale).toBe(true);
      expect(contests.refresh).toHaveBeenCalledWith(false, "official");
    });

    it("returns an error when a scoped refresh fails without cache", async () => {
      const contests = {
        refresh: jest.fn().mockRejectedValue(new Error("boom")),
        getLastRefreshAt: jest.fn().mockReturnValue(0),
      };

      const result = await refreshContestData(contests, "gym");

      expect("error" in result).toBe(true);
    });

    it("marks stale when any all-scope refresh fails with cached data", async () => {
      const contests = {
        refresh: jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("boom")),
        getLastRefreshAt: jest.fn().mockReturnValue(456),
      };

      const result = await refreshContestData(contests, "all");

      expect("stale" in result && result.stale).toBe(true);
      expect(contests.refresh).toHaveBeenNthCalledWith(1, false, "official");
      expect(contests.refresh).toHaveBeenNthCalledWith(2, false, "gym");
    });

    it("returns an error when all-scope refresh has no cache", async () => {
      const contests = {
        refresh: jest.fn().mockRejectedValue(new Error("boom")),
        getLastRefreshAt: jest.fn().mockReturnValue(0),
      };

      const result = await refreshContestData(contests, "all");

      expect("error" in result).toBe(true);
    });
  });
});
