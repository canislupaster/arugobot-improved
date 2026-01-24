import { ContestService } from "../../src/services/contests.js";

const mockClient = {
  request: jest.fn(),
};

describe("ContestService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockClient.request.mockReset();
  });

  it("returns upcoming and ongoing contests sorted by start time", async () => {
    const nowMs = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(nowMs);
    const nowSeconds = Math.floor(nowMs / 1000);

    mockClient.request.mockResolvedValueOnce([
      {
        id: 1,
        name: "Contest A",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 7200,
        durationSeconds: 7200,
      },
      {
        id: 2,
        name: "Contest B",
        phase: "CODING",
        startTimeSeconds: nowSeconds - 3600,
        durationSeconds: 7200,
      },
      {
        id: 3,
        name: "Contest C",
        phase: "BEFORE",
        startTimeSeconds: nowSeconds + 3600,
        durationSeconds: 7200,
      },
    ]);

    const service = new ContestService(mockClient as never);
    await service.refresh(true);

    const upcoming = service.getUpcoming(2);
    expect(upcoming.map((contest) => contest.id)).toEqual([3, 1]);

    const ongoing = service.getOngoing();
    expect(ongoing).toHaveLength(1);
    expect(ongoing[0]?.id).toBe(2);
  });
});
