import {
  beginServiceTick,
  createServiceTickState,
  runServiceTick,
} from "../../src/utils/serviceTicks.js";

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
