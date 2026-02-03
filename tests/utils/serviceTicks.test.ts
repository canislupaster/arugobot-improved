import { beginServiceTick, runServiceTick } from "../../src/utils/serviceTicks.js";

describe("beginServiceTick", () => {
  it("starts a tick when idle and clears on finish", () => {
    let isTicking = false;
    let lastTickAt = "";
    const finish = beginServiceTick({
      isTicking,
      setTicking: (value) => {
        isTicking = value;
      },
      setLastTickAt: (value) => {
        lastTickAt = value;
      },
    });

    expect(finish).not.toBeNull();
    expect(isTicking).toBe(true);
    expect(lastTickAt).not.toBe("");

    finish?.();
    expect(isTicking).toBe(false);
  });

  it("returns null when already ticking", () => {
    let isTicking = true;
    let lastTickAt = "";
    const finish = beginServiceTick({
      isTicking,
      setTicking: (value) => {
        isTicking = value;
      },
      setLastTickAt: (value) => {
        lastTickAt = value;
      },
    });

    expect(finish).toBeNull();
    expect(isTicking).toBe(true);
    expect(lastTickAt).toBe("");
  });
});

describe("runServiceTick", () => {
  it("runs a handler when idle and clears ticking state", async () => {
    let isTicking = false;
    let lastTickAt = "";
    let ran = false;
    const result = await runServiceTick(
      {
        isTicking,
        setTicking: (value) => {
          isTicking = value;
        },
        setLastTickAt: (value) => {
          lastTickAt = value;
        },
      },
      async () => {
        ran = true;
        expect(isTicking).toBe(true);
      }
    );

    expect(result).toBe(true);
    expect(ran).toBe(true);
    expect(isTicking).toBe(false);
    expect(lastTickAt).not.toBe("");
  });

  it("returns false when already ticking", async () => {
    let isTicking = true;
    let lastTickAt = "";
    const result = await runServiceTick(
      {
        isTicking,
        setTicking: (value) => {
          isTicking = value;
        },
        setLastTickAt: (value) => {
          lastTickAt = value;
        },
      },
      async () => {}
    );

    expect(result).toBe(false);
    expect(isTicking).toBe(true);
    expect(lastTickAt).toBe("");
  });
});
