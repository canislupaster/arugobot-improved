import { formatSubmissionLine } from "../../src/utils/submissions.js";

describe("formatSubmissionLine", () => {
  it("formats contest submissions with links", () => {
    const line = formatSubmissionLine({
      contestId: 1000,
      index: "A",
      name: "Test Problem",
      verdict: "OK",
      creationTimeSeconds: 1_700_000_000,
    });

    expect(line).toContain("https://codeforces.com/problemset/problem/1000/A");
    expect(line).toContain("OK");
  });

  it("formats non-contest submissions without links", () => {
    const line = formatSubmissionLine({
      contestId: null,
      index: "A",
      name: "Practice Problem",
      verdict: null,
      creationTimeSeconds: 1_700_000_000,
    });

    expect(line).toContain("Practice Problem");
    expect(line).toContain("UNKNOWN");
    expect(line).not.toContain("problemset/problem");
  });
});
