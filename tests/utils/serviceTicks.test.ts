import {
  beginServiceTick,
  createAsyncTaskTracker,
  createServiceTickState,
  createServiceTickTracker,
  runServiceTick,
} from "../../src/utils/serviceTicks.js";

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolveFn) => {
    resolve = resolveFn;
  });
  return { promise, resolve };
};

describe("beginServiceTick", () => {
  it("starts a tick when idle and clears on finish", () => {
    const target = { isTicking: false, lastTickAt: "" };
    const finish = beginServiceTick(
      createServiceTickState(
        () => target.isTicking,
        (value) => {
          target.isTicking = value;
        },
        (value) => {
          target.lastTickAt = value;
        }
      )
    );

    expect(finish).not.toBeNull();
    expect(target.isTicking).toBe(true);
    expect(target.lastTickAt).not.toBe("");

    finish?.();
    expect(target.isTicking).toBe(false);
  });

  it("returns null when already ticking", () => {
    const target = { isTicking: true, lastTickAt: "" };
    const finish = beginServiceTick(
      createServiceTickState(
        () => target.isTicking,
        (value) => {
          target.isTicking = value;
        },
        (value) => {
          target.lastTickAt = value;
        }
      )
    );

    expect(finish).toBeNull();
    expect(target.isTicking).toBe(true);
    expect(target.lastTickAt).toBe("");
  });
});

describe("runServiceTick", () => {
  it("runs a handler when idle and clears ticking state", async () => {
    const target = { isTicking: false, lastTickAt: "" };
    let ran = false;
    const result = await runServiceTick(
      createServiceTickState(
        () => target.isTicking,
        (value) => {
          target.isTicking = value;
        },
        (value) => {
          target.lastTickAt = value;
        }
      ),
      async () => {
        ran = true;
        expect(target.isTicking).toBe(true);
      }
    );

    expect(result).toBe(true);
    expect(ran).toBe(true);
    expect(target.isTicking).toBe(false);
    expect(target.lastTickAt).not.toBe("");
  });

  it("returns false when already ticking", async () => {
    const target = { isTicking: true, lastTickAt: "" };
    const result = await runServiceTick(
      createServiceTickState(
        () => target.isTicking,
        (value) => {
          target.isTicking = value;
        },
        (value) => {
          target.lastTickAt = value;
        }
      ),
      async () => {}
    );

    expect(result).toBe(false);
    expect(target.isTicking).toBe(true);
    expect(target.lastTickAt).toBe("");
  });
});

describe("createServiceTickState", () => {
  it("reads and writes ticking state on the target", () => {
    const target = { isTicking: false, lastTickAt: null as string | null };
    const state = createServiceTickState(
      () => target.isTicking,
      (value) => {
        target.isTicking = value;
      },
      (value) => {
        target.lastTickAt = value;
      }
    );

    expect(state.getIsTicking()).toBe(false);
    state.setTicking(true);
    state.setLastTickAt("2026-02-03T00:00:00.000Z");

    expect(target.isTicking).toBe(true);
    expect(target.lastTickAt).toBe("2026-02-03T00:00:00.000Z");
  });
});

describe("createServiceTickTracker", () => {
  it("tracks last tick and error state", () => {
    const tracker = createServiceTickTracker();
    expect(tracker.getLastTickAt()).toBeNull();
    expect(tracker.getLastError()).toBeNull();

    const finish = beginServiceTick(tracker.tickState);
    expect(tracker.getLastTickAt()).not.toBeNull();

    tracker.setLastError({ message: "boom", timestamp: "2026-02-03T00:00:00.000Z" });
    expect(tracker.getLastError()?.message).toBe("boom");

    finish?.();
  });
});

describe("createAsyncTaskTracker", () => {
  it("tracks pending tasks and clears after resolution", async () => {
    const tracker = createAsyncTaskTracker();
    const deferred = createDeferred<void>();
    tracker.track(deferred.promise);

    expect(tracker.getPendingCount()).toBe(1);

    deferred.resolve();
    await deferred.promise;

    expect(tracker.getPendingCount()).toBe(0);
  });

  it("returns timeout when tasks are still running", async () => {
    const tracker = createAsyncTaskTracker();
    tracker.track(new Promise<void>(() => {}));

    const result = await tracker.waitForIdle(5);

    expect(result.status).toBe("timeout");
    expect(result.pending).toBeGreaterThan(0);
  });
});
