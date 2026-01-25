import {
  filterSubmissionsByResult,
  formatSubmissionLine,
  formatSubmissionLines,
} from "../../src/utils/submissions.js";

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

describe("filterSubmissionsByResult", () => {
  const submissions = [
    {
      contestId: 1000,
      index: "A",
      name: "Accepted Problem",
      verdict: "OK",
      creationTimeSeconds: 1_700_000_000,
    },
    {
      contestId: 1000,
      index: "B",
      name: "Rejected Problem",
      verdict: "WRONG_ANSWER",
      creationTimeSeconds: 1_700_000_100,
    },
    {
      contestId: 1000,
      index: "C",
      name: "Unknown Verdict",
      verdict: null,
      creationTimeSeconds: 1_700_000_200,
    },
  ];

  it("keeps all submissions for the default filter", () => {
    expect(filterSubmissionsByResult(submissions, "all")).toHaveLength(3);
  });

  it("filters accepted submissions", () => {
    const filtered = filterSubmissionsByResult(submissions, "accepted");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.verdict).toBe("OK");
  });

  it("filters rejected submissions", () => {
    const filtered = filterSubmissionsByResult(submissions, "rejected");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((entry) => entry.verdict !== "OK")).toBe(true);
  });
});

describe("formatSubmissionLines", () => {
  it("formats multiple submissions as newline-separated lines", () => {
    const lines = formatSubmissionLines([
      {
        contestId: 1000,
        index: "A",
        name: "Accepted Problem",
        verdict: "OK",
        creationTimeSeconds: 1_700_000_000,
      },
      {
        contestId: null,
        index: "B",
        name: "Practice Problem",
        verdict: null,
        creationTimeSeconds: 1_700_000_100,
      },
    ]);

    expect(lines.split("\n")).toHaveLength(2);
    expect(lines).toContain("Accepted Problem");
    expect(lines).toContain("Practice Problem");
  });
});
