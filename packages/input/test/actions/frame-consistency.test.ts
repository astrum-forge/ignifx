import { Script } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { createInputApp, demoActions } from "../support/app.js";
import type { InputAppHarness } from "../support/app.js";

/**
 * `docs/architecture/01-lifecycle-and-time.md` §4: "read input state captured at frame start;
 * `app.input` values are stable during the whole frame", and `08-input.md` §1: "edge flags
 * (`wasPressedThisFrame`) are valid for the whole frame including all fixed steps".
 */

/** Records what the jump action reads in every callback of every frame. */
class Probe extends Script {
  static typeId = "test/InputProbe";

  readonly fixedPressed: boolean[] = [];

  readonly updatePressed: boolean[] = [];

  readonly lateVector: number[] = [];

  fixedUpdate(): void {
    this.fixedPressed.push(this.app.input.actions.get("jump").wasPressedThisFrame);
  }

  update(): void {
    this.updatePressed.push(this.app.input.actions.get("jump").wasPressedThisFrame);
  }

  lateUpdate(): void {
    this.lateVector.push(this.app.input.actions.get("move").vector.x);
  }
}

let harness: InputAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Builds a headless app whose frame runs several fixed steps and returns the probe. */
async function withProbe(): Promise<{ readonly built: InputAppHarness; readonly probe: Probe }> {
  const built = await createInputApp({ settings: { time: { maximumDeltaTime: 1 } } });
  harness = built;
  built.app.input.loadActions(demoActions());
  built.app.registerComponents([Probe]);
  const entity = built.app.world.createEntity("probe");
  const probe = entity.addComponent(Probe);
  built.step(1 / 60);
  probe.fixedPressed.length = 0;
  probe.updatePressed.length = 0;
  probe.lateVector.length = 0;
  return { built, probe };
}

describe("frame-consistent edge flags", () => {
  it("holds wasPressedThisFrame true through every fixed step of the frame it resolved in", async () => {
    const { built, probe } = await withProbe();
    built.app.input.simulate({ "<Keyboard>/space": 1 });
    built.step(5 / 60);
    expect(probe.fixedPressed).toHaveLength(5);
    expect(probe.fixedPressed.every((value) => value)).toBe(true);
    expect(probe.updatePressed).toEqual([true]);
  });

  it("clears wasPressedThisFrame in the next frame, in every fixed step", async () => {
    const { built, probe } = await withProbe();
    built.app.input.simulate({ "<Keyboard>/space": 1 });
    built.step(5 / 60);
    probe.fixedPressed.length = 0;
    built.step(5 / 60);
    expect(probe.fixedPressed).toHaveLength(5);
    expect(probe.fixedPressed.some((value) => value)).toBe(false);
    expect(built.app.input.actions.get("jump").isPressed).toBe(true);
  });

  it("keeps the action value identical in fixedUpdate, update, and lateUpdate", async () => {
    const { built, probe } = await withProbe();
    built.app.input.simulate({ "<Keyboard>/d": 1 });
    built.step(3 / 60);
    expect(probe.lateVector).toEqual([1]);
    expect(built.app.input.actions.get("move").vector.x).toBe(1);
  });

  it("holds wasReleasedThisFrame for the whole frame too", async () => {
    const { built } = await withProbe();
    const jump = built.app.input.actions.get("jump");
    built.app.input.simulate({ "<Keyboard>/space": 1 });
    built.step(1 / 60);
    built.app.input.simulate({ "<Keyboard>/space": 0 });
    built.step(4 / 60);
    expect(jump.wasReleasedThisFrame).toBe(true);
    built.step(1 / 60);
    expect(jump.wasReleasedThisFrame).toBe(false);
  });

  it("does not resolve input again between the fixed steps of one frame", async () => {
    const { built, probe } = await withProbe();
    built.app.input.simulate({ "<Keyboard>/space": 1 });
    built.app.input.simulate({ "<Keyboard>/space": 0 });
    built.step(4 / 60);
    // Both events land in the same drain, so the frame ends released and never reports a press.
    expect(probe.fixedPressed).toEqual([false, false, false, false]);
  });
});
