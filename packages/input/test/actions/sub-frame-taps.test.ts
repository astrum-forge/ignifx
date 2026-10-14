import { afterEach, describe, expect, it } from "vitest";
import { defineInputActions } from "../../src/index.js";
import { createInputApp } from "../support/app.js";
import type { InputActionsDefinition } from "../../src/index.js";
import type { InputAppHarness } from "../support/app.js";

/**
 * A press and a release that both land between two frames (`docs/architecture/08-input.md` §1).
 * Actions are resolved from device state once per frame, so a tap shorter than a frame used to
 * leave nothing behind: a quick click, a phone tap at 20–30 fps, or an instant Escape during a
 * rebind was lost. The press now resolves in the next frame and the release in the one after.
 */

let harness: InputAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** One button action per device the DOM writes. */
function tapActions(): InputActionsDefinition {
  return defineInputActions({
    maps: [
      {
        name: "Player",
        actions: [
          { name: "jump", type: "button", bindings: [{ path: "<Keyboard>/space" }] },
          { name: "fire", type: "button", bindings: [{ path: "<Mouse>/leftButton" }] },
          { name: "point", type: "button", bindings: [{ path: "<Pointer>/press" }] },
          { name: "tap", type: "button", bindings: [{ path: "<Touch>/primaryTouch/press" }] },
          { name: "virtual", type: "button", bindings: [{ path: "<Virtual>/buttonA" }] },
        ],
      },
    ],
  });
}

/** Builds the app with {@link tapActions} installed. */
async function withTaps(): Promise<InputAppHarness> {
  const built = await createInputApp();
  built.app.input.loadActions(tapActions());
  harness = built;
  return built;
}

/** What one action reported over the frames a test stepped. */
interface Trace {
  readonly pressed: boolean[];
  readonly down: boolean[];
  readonly up: boolean[];
  readonly signals: string[];
}

/**
 * Steps three frames after the events were queued and records the action each frame.
 *
 * @param built - The harness.
 * @param name - The action to watch.
 * @returns The per-frame readings and every signal, in order.
 */
function trace(built: InputAppHarness, name: string): Trace {
  const action = built.app.input.actions.get(name);
  const result: Trace = { pressed: [], down: [], up: [], signals: [] };
  action.onStarted.connect(() => result.signals.push("started"));
  action.onPerformed.connect(() => result.signals.push("performed"));
  action.onCanceled.connect(() => result.signals.push("canceled"));
  for (let frame = 0; frame < 3; frame += 1) {
    built.step();
    result.pressed.push(action.isPressed);
    result.down.push(action.wasPressedThisFrame);
    result.up.push(action.wasReleasedThisFrame);
  }
  return result;
}

/** The trace a tap must leave: pressed for one frame, then released. */
const TAPPED: Trace = {
  pressed: [true, false, false],
  down: [true, false, false],
  up: [false, true, false],
  signals: ["started", "performed", "canceled"],
};

describe("a press and a release between two frames", () => {
  it("presses a keyboard action for one frame, then releases it", async () => {
    const built = await withTaps();
    built.app.input.simulateEvent({ type: "keydown", code: "space" });
    built.app.input.simulateEvent({ type: "keyup", code: "space" });
    expect(trace(built, "jump")).toEqual(TAPPED);
  });

  it("presses a mouse-button action and the pointer press for one frame", async () => {
    const built = await withTaps();
    built.app.input.simulateEvent({ type: "pointerdown", x: 10, y: 20, button: 0 });
    built.app.input.simulateEvent({ type: "pointerup", x: 10, y: 20, button: 0 });
    const fire = built.app.input.actions.get("fire");
    const point = built.app.input.actions.get("point");
    built.step();
    expect([fire.wasPressedThisFrame, point.wasPressedThisFrame]).toEqual([true, true]);
    built.step();
    expect([fire.wasReleasedThisFrame, point.wasReleasedThisFrame]).toEqual([true, true]);
    expect([fire.isPressed, point.isPressed]).toEqual([false, false]);
  });

  it("presses a touch action for one frame", async () => {
    const built = await withTaps();
    built.app.input.simulateEvent({ type: "pointerdown", x: 5, y: 5, pointerId: 7, pointerType: "touch" });
    built.app.input.simulateEvent({ type: "pointerup", x: 5, y: 5, pointerId: 7, pointerType: "touch" });
    expect(trace(built, "tap")).toEqual(TAPPED);
  });

  it("presses a simulated control for one frame", async () => {
    const built = await withTaps();
    built.app.input.simulate({ "<Keyboard>/space": 1 });
    built.app.input.simulate({ "<Keyboard>/space": 0 });
    expect(trace(built, "jump")).toEqual(TAPPED);
  });

  it("presses an on-screen virtual button for one frame", async () => {
    const built = await withTaps();
    built.step();
    built.app.input.devices.virtual.set("buttonA", 1);
    built.app.input.devices.virtual.set("buttonA", 0);
    expect(trace(built, "virtual")).toEqual(TAPPED);
  });

  it("leaves a held key alone, and releases a key held across frames on time", async () => {
    const built = await withTaps();
    const jump = built.app.input.actions.get("jump");
    built.app.input.simulateEvent({ type: "keydown", code: "space" });
    built.step();
    built.step();
    expect(jump.isPressed).toBe(true);
    // Pressed in an earlier frame, so the release is not held over.
    built.app.input.simulateEvent({ type: "keyup", code: "space" });
    built.step();
    expect(jump.isPressed).toBe(false);
    expect(jump.wasReleasedThisFrame).toBe(true);
  });

  it("does not hold a tap over when focus is lost in the same frame", async () => {
    const built = await withTaps();
    const jump = built.app.input.actions.get("jump");
    built.app.input.simulateEvent({ type: "keydown", code: "space" });
    built.app.input.releaseAll();
    built.step();
    expect(jump.isPressed).toBe(false);
    built.step();
    expect(jump.isPressed).toBe(false);
  });

  it("keeps the key down when it is pressed again in the same frame", async () => {
    const built = await withTaps();
    const jump = built.app.input.actions.get("jump");
    built.app.input.simulateEvent({ type: "keydown", code: "space" });
    built.app.input.simulateEvent({ type: "keyup", code: "space" });
    built.app.input.simulateEvent({ type: "keydown", code: "space" });
    built.step();
    built.step();
    built.step();
    expect(jump.isPressed).toBe(true);
    expect(
      built.app.input.devices.keyboard.valueAt(built.app.input.devices.keyboard.control("anyKey")?.offset ?? -1),
    ).toBe(1);
  });
});
