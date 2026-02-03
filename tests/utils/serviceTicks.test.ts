import { beginServiceTick } from "../../src/utils/serviceTicks.js";

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
