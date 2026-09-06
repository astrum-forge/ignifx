import { describe, expect, it } from "vitest";
import { defineAnimator } from "../../src/animator/definition.js";
import { AnimatorStateMachine } from "../../src/animator/state-machine.js";
import { ThreeDErrorCode } from "../../src/errors.js";
import { heroAnimator } from "../support/animator-fixture.js";
import type { ClipWeight } from "../../src/animator/state-machine.js";

/** One sixtieth of a second, the default fixed step. */
const STEP = 1 / 60;

/**
 * Builds a hero machine with every clip declared one second long.
 *
 * @returns The machine.
 */
function heroMachine(): AnimatorStateMachine {
  const machine = new AnimatorStateMachine(heroAnimator());
  for (const clip of ["idle", "walk", "run", "jump"]) {
    machine.setClipLength(clip, 1);
  }
  return machine;
}

/**
 * The weight of one clip in the machine's current output.
 *
 * @param machine - The machine.
 * @param clip - The clip name.
 * @returns The weight, or `0` when the clip contributes nothing.
 */
function weightOf(machine: AnimatorStateMachine, clip: string): number {
  return machine.clips.find((entry: ClipWeight) => entry.clip === clip)?.weight ?? 0;
}

/**
 * Advances a machine by `count` steps.
 *
 * @param machine - The machine.
 * @param count - How many steps.
 * @param step - The step size; the fixed step by default.
 */
function advance(machine: AnimatorStateMachine, count: number, step: number = STEP): void {
  for (let index = 0; index < count; index += 1) {
    machine.advance(step);
  }
}

describe("AnimatorStateMachine", () => {
  it("starts every layer in its default state", () => {
    const machine = heroMachine();
    expect(machine.currentState()).toBe("locomotion");
    expect(machine.normalizedTime()).toBe(0);
    expect(weightOf(machine, "idle")).toBeCloseTo(1, 6);
  });

  it("reports the state entries it made while starting", () => {
    const machine = heroMachine();
    const changes: { layer: string; state: string; entered: boolean }[] = [];
    machine.drainStateChanges(changes);
    expect(changes).toEqual([{ layer: "Base", state: "locomotion", entered: true }]);
    const again: { layer: string; state: string; entered: boolean }[] = [];
    machine.drainStateChanges(again);
    expect(again).toEqual([]);
  });

  it("blends a 1D tree between its neighbours and clamps at the ends", () => {
    const machine = heroMachine();
    machine.setFloat("speed", 1);
    machine.advance(0);
    expect(weightOf(machine, "idle")).toBeCloseTo(0.5, 6);
    expect(weightOf(machine, "walk")).toBeCloseTo(0.5, 6);

    machine.setFloat("speed", 2);
    machine.advance(0);
    expect(weightOf(machine, "walk")).toBeCloseTo(1, 6);
    expect(weightOf(machine, "idle")).toBe(0);

    machine.setFloat("speed", 4);
    machine.advance(0);
    expect(weightOf(machine, "walk")).toBeCloseTo(0.5, 6);
    expect(weightOf(machine, "run")).toBeCloseTo(0.5, 6);

    machine.setFloat("speed", 100);
    machine.advance(0);
    expect(weightOf(machine, "run")).toBeCloseTo(1, 6);

    machine.setFloat("speed", -10);
    machine.advance(0);
    expect(weightOf(machine, "idle")).toBeCloseTo(1, 6);
  });

  it("takes an any-state transition on a trigger and consumes it once", () => {
    const machine = heroMachine();
    machine.setTrigger("jump");
    expect(machine.isTriggerSet("jump")).toBe(true);
    machine.advance(STEP);
    expect(machine.currentState()).toBe("jump");
    expect(machine.isTriggerSet("jump")).toBe(false);

    // Coming back out and stepping again must not re-fire: the trigger is gone.
    machine.play("locomotion");
    advance(machine, 10);
    expect(machine.currentState()).toBe("locomotion");
  });

  it("does not take an any-state transition into the state it is already in", () => {
    const machine = heroMachine();
    machine.play("jump");
    machine.setTrigger("jump");
    machine.advance(STEP);
    expect(machine.currentState()).toBe("jump");
    expect(machine.isTriggerSet("jump")).toBe(true);
  });

  it("holds a transition until its exit time", () => {
    const machine = heroMachine();
    machine.setBool("grounded", true);
    machine.play("jump");
    advance(machine, 30);
    expect(machine.currentState()).toBe("jump");
    expect(machine.normalizedTime()).toBeCloseTo(0.5, 2);
    advance(machine, 30);
    expect(machine.currentState()).toBe("locomotion");
  });

  it("crossfades: both states contribute while the blend runs", () => {
    const machine = heroMachine();
    machine.crossFade("jump", 0.4);
    machine.advance(0.2);
    expect(machine.isInTransition()).toBe(true);
    expect(weightOf(machine, "jump")).toBeCloseTo(0.5, 6);
    expect(weightOf(machine, "idle")).toBeCloseTo(0.5, 6);
    machine.advance(0.2);
    expect(machine.isInTransition()).toBe(false);
    expect(weightOf(machine, "jump")).toBeCloseTo(1, 6);
  });

  it("play with no transition cuts, and reports the exit immediately", () => {
    const machine = heroMachine();
    const changes: { layer: string; state: string; entered: boolean }[] = [];
    machine.drainStateChanges(changes);
    changes.length = 0;
    machine.play("jump");
    machine.drainStateChanges(changes);
    expect(changes).toEqual([
      { layer: "Base", state: "locomotion", entered: false },
      { layer: "Base", state: "jump", entered: true },
    ]);
    expect(machine.isInTransition()).toBe(false);
  });

  it("refuses to interrupt a transition unless the new one says it may", () => {
    const definition = defineAnimator(
      {
        parameters: [
          { name: "go", kind: "bool" },
          { name: "urgent", kind: "bool" },
        ],
        states: [
          { name: "a", clip: "a" },
          { name: "b", clip: "b" },
          { name: "c", clip: "c" },
        ],
        transitions: [
          { from: "a", to: "b", conditions: [{ param: "go", op: "eq", value: 1 }], duration: 1 },
          {
            from: "any",
            to: "c",
            conditions: [{ param: "urgent", op: "eq", value: 1 }],
            duration: 0,
            interruptible: false,
          },
        ],
      },
      "x",
    );
    const machine = new AnimatorStateMachine(definition);
    machine.setBool("go", true);
    machine.advance(0.1);
    expect(machine.isInTransition()).toBe(true);
    machine.setBool("urgent", true);
    machine.advance(0.1);
    expect(machine.currentState()).toBe("b");

    const interruptible = new AnimatorStateMachine(
      defineAnimator(
        {
          parameters: [
            { name: "go", kind: "bool" },
            { name: "urgent", kind: "bool" },
          ],
          states: [
            { name: "a", clip: "a" },
            { name: "b", clip: "b" },
            { name: "c", clip: "c" },
          ],
          transitions: [
            { from: "a", to: "b", conditions: [{ param: "go", op: "eq", value: 1 }], duration: 1 },
            {
              from: "any",
              to: "c",
              conditions: [{ param: "urgent", op: "eq", value: 1 }],
              duration: 0,
              interruptible: true,
            },
          ],
        },
        "x",
      ),
    );
    interruptible.setBool("go", true);
    interruptible.advance(0.1);
    interruptible.setBool("urgent", true);
    interruptible.advance(0.1);
    expect(interruptible.currentState()).toBe("c");
  });

  it("evaluates every comparison operator", () => {
    const definition = defineAnimator(
      {
        parameters: [{ name: "n", kind: "float", value: 5 }],
        states: [
          { name: "a", clip: "a" },
          { name: "b", clip: "b" },
        ],
        transitions: [{ from: "a", to: "b", conditions: [{ param: "n", op: "gt", value: 4 }], duration: 0 }],
      },
      "x",
    );
    const machine = new AnimatorStateMachine(definition);
    machine.advance(0);
    expect(machine.currentState()).toBe("b");

    for (const [op, value, expected] of [
      ["gte", 5, "b"],
      ["lt", 6, "b"],
      ["lte", 5, "b"],
      ["eq", 5, "b"],
      ["neq", 4, "b"],
      ["gt", 9, "a"],
      ["lt", 1, "a"],
      ["eq", 1, "a"],
      ["neq", 5, "a"],
      ["gte", 9, "a"],
      ["lte", 1, "a"],
    ] as const) {
      const one = new AnimatorStateMachine(
        defineAnimator(
          {
            parameters: [{ name: "n", kind: "float", value: 5 }],
            states: [
              { name: "a", clip: "a" },
              { name: "b", clip: "b" },
            ],
            transitions: [{ from: "a", to: "b", conditions: [{ param: "n", op, value }], duration: 0 }],
          },
          "x",
        ),
      );
      one.advance(0);
      expect(one.currentState(), `${op} ${String(value)}`).toBe(expected);
    }
  });

  it("fires an event once per loop crossing", () => {
    const definition = defineAnimator(
      { states: [{ name: "run", clip: "run", loop: true, events: [{ time: 0.25, name: "step" }] }] },
      "x",
    );
    const machine = new AnimatorStateMachine(definition);
    machine.setClipLength("run", 1);
    const events: string[] = [];

    machine.advance(0.2);
    machine.drainEvents(events);
    expect(events).toEqual([]);

    machine.advance(0.1);
    machine.drainEvents(events);
    expect(events).toEqual(["step"]);

    events.length = 0;
    machine.advance(1);
    machine.drainEvents(events);
    expect(events).toEqual(["step"]);

    // A single huge step crosses three more loops and fires three times, not once.
    events.length = 0;
    machine.advance(3);
    machine.drainEvents(events);
    expect(events).toEqual(["step", "step", "step"]);
  });

  it("does not fire events while playing backwards", () => {
    const definition = defineAnimator(
      { states: [{ name: "run", clip: "run", speed: -1, events: [{ time: 0.5, name: "step" }] }] },
      "x",
    );
    const machine = new AnimatorStateMachine(definition);
    machine.setClipLength("run", 1);
    const events: string[] = [];
    machine.advance(1);
    machine.drainEvents(events);
    expect(events).toEqual([]);
  });

  it("clamps a non-looping state's normalized time at 1", () => {
    const definition = defineAnimator({ states: [{ name: "once", clip: "once", loop: false }] }, "x");
    const machine = new AnimatorStateMachine(definition);
    machine.setClipLength("once", 0.5);
    machine.advance(5);
    expect(machine.normalizedTime()).toBe(1);
  });

  it("scales every layer with its speed multiplier", () => {
    const machine = heroMachine();
    machine.speed = 2;
    machine.advance(0.25);
    expect(machine.normalizedTime()).toBeCloseTo(0.5, 6);
    expect(machine.clips[0]?.speed).toBeCloseTo(2, 6);
  });

  it("uses a blend tree's longest child as the state's length", () => {
    const machine = new AnimatorStateMachine(heroAnimator());
    machine.setClipLength("idle", 1);
    machine.setClipLength("walk", 2);
    machine.setClipLength("run", 4);
    machine.advance(2);
    expect(machine.normalizedTime()).toBeCloseTo(0.5, 6);
  });

  it("blends two layers by their weights", () => {
    const definition = defineAnimator(
      {
        layers: [
          { name: "Base", weight: 1 },
          { name: "Upper", weight: 0.25, additive: true, mask: ["spine"], maskMode: "include" },
        ],
        states: [
          { name: "walk", clip: "walk", layer: "Base" },
          { name: "aim", clip: "aim", layer: "Upper" },
        ],
      },
      "x",
    );
    const machine = new AnimatorStateMachine(definition);
    machine.advance(0);
    expect(weightOf(machine, "walk")).toBeCloseTo(1, 6);
    expect(weightOf(machine, "aim")).toBeCloseTo(0.25, 6);
    expect(machine.clips.find((clip) => clip.clip === "aim")?.additive).toBe(true);
  });

  it("skips a layer whose weight is zero", () => {
    const definition = defineAnimator(
      {
        layers: [
          { name: "Base", weight: 1 },
          { name: "Off", weight: 0 },
        ],
        states: [
          { name: "walk", clip: "walk", layer: "Base" },
          { name: "aim", clip: "aim", layer: "Off" },
        ],
      },
      "x",
    );
    const machine = new AnimatorStateMachine(definition);
    machine.advance(0);
    expect(weightOf(machine, "aim")).toBe(0);
  });

  it("reads and writes every parameter kind, and refuses the wrong setter", () => {
    const machine = heroMachine();
    machine.setFloat("speed", 3.5);
    expect(machine.getFloat("speed")).toBe(3.5);
    machine.setBool("grounded", false);
    expect(machine.getBool("grounded")).toBe(false);
    machine.setTrigger("jump");
    machine.resetTrigger("jump");
    expect(machine.isTriggerSet("jump")).toBe(false);

    expect(() => machine.setInt("speed", 1)).toThrow(
      expect.objectContaining({ code: ThreeDErrorCode.parameterKindMismatch }),
    );
    expect(() => machine.setTrigger("speed")).toThrow(
      expect.objectContaining({ code: ThreeDErrorCode.parameterKindMismatch }),
    );
    expect(() => machine.setFloat("ghost", 1)).toThrow(
      expect.objectContaining({ code: ThreeDErrorCode.unknownParameter }),
    );
    expect(() => machine.getFloat("ghost")).toThrow(
      expect.objectContaining({ code: ThreeDErrorCode.unknownParameter }),
    );
    expect(() => machine.setTrigger("ghost")).toThrow(
      expect.objectContaining({ code: ThreeDErrorCode.unknownParameter }),
    );
  });

  it("truncates an int parameter", () => {
    const definition = defineAnimator(
      { parameters: [{ name: "combo", kind: "int" }], states: [{ name: "a", clip: "a" }] },
      "x",
    );
    const machine = new AnimatorStateMachine(definition);
    machine.setInt("combo", 2.9);
    expect(machine.getFloat("combo")).toBe(2);
  });

  it("refuses to play a state it does not declare", () => {
    const machine = heroMachine();
    expect(() => machine.play("cartwheel")).toThrow(expect.objectContaining({ code: ThreeDErrorCode.unknownState }));
  });

  it("falls back to the base layer when a name is not declared", () => {
    const machine = heroMachine();
    expect(machine.currentState("Nonexistent")).toBe("locomotion");
  });

  it("exposes the document it runs", () => {
    const machine = heroMachine();
    expect(machine.definition.states).toHaveLength(2);
  });
});
