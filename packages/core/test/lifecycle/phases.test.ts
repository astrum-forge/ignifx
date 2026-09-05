import { describe, expect, it } from "vitest";
import { createServiceKey, PHASE_NAMES, PHASES, Phase } from "../../src/app/types.js";
import { PHASE_COUNT } from "../../src/diagnostics/frame-sample.js";
import {
  FIRST_DISPATCHED_CALLBACK,
  SCRIPT_CALLBACK_COUNT,
  SCRIPT_CALLBACK_NAMES,
  ScriptCallbackKind,
  readCallback,
} from "../../src/lifecycle/callbacks.js";
import { createFrameState } from "../../src/lifecycle/frame-state.js";

/** `docs/architecture/01-lifecycle-and-time.md` §3 and §4. */

/** A method the callback reader can find on an object. */
const noop = function update(this: void): void {
  // no body needed
};

describe("Phase", () => {
  it("numbers the phases in frame order", () => {
    expect(Phase.EndOfFrame).toBe(0);
    expect(Phase.PreUpdate).toBe(1);
    expect(Phase.FixedUpdate).toBe(2);
    expect(Phase.Update).toBe(3);
    expect(Phase.PostUpdate).toBe(4);
    expect(Phase.PreRender).toBe(5);
  });

  it("lists every phase once, in order, with a matching name", () => {
    expect(PHASES).toEqual([0, 1, 2, 3, 4, 5]);
    expect(PHASE_NAMES).toEqual(["EndOfFrame", "PreUpdate", "FixedUpdate", "Update", "PostUpdate", "PreRender"]);
    expect(new Set(PHASES).size).toBe(PHASES.length);
  });

  it("agrees with the diagnostics per-phase timing array", () => {
    expect(PHASES).toHaveLength(PHASE_COUNT);
    expect(PHASE_NAMES).toHaveLength(PHASE_COUNT);
  });
});

describe("ScriptCallbackKind", () => {
  it("numbers every callback once and names them all", () => {
    const ordinals = Object.values(ScriptCallbackKind);
    expect(ordinals).toHaveLength(SCRIPT_CALLBACK_COUNT);
    expect(new Set(ordinals).size).toBe(SCRIPT_CALLBACK_COUNT);
    expect(SCRIPT_CALLBACK_NAMES).toHaveLength(SCRIPT_CALLBACK_COUNT);
    for (const [name, ordinal] of Object.entries(ScriptCallbackKind)) {
      expect(SCRIPT_CALLBACK_NAMES[ordinal]).toBe(name);
    }
  });

  it("puts the five flush-driven callbacks before the dispatched ones", () => {
    expect(FIRST_DISPATCHED_CALLBACK).toBe(ScriptCallbackKind.fixedUpdate);
    expect(ScriptCallbackKind.awake).toBeLessThan(FIRST_DISPATCHED_CALLBACK);
    expect(ScriptCallbackKind.onDestroy).toBeLessThan(FIRST_DISPATCHED_CALLBACK);
    expect(ScriptCallbackKind.onApplicationFocus).toBe(SCRIPT_CALLBACK_COUNT - 1);
  });
});

describe("readCallback", () => {
  it("returns the method when one exists and null otherwise", () => {
    const target = { update: noop, notAFunction: 3 };
    expect(readCallback(target, "update")).toBe(noop);
    expect(readCallback(target, "notAFunction")).toBeNull();
    expect(readCallback(target, "missing")).toBeNull();
  });
});

describe("createServiceKey", () => {
  it("builds a frozen, named token", () => {
    const key = createServiceKey<{ value: number }>("storage");
    expect(key.serviceName).toBe("storage");
    expect(Object.isFrozen(key)).toBe(true);
    expect(createServiceKey("storage")).not.toBe(key);
  });
});

describe("the frame-state controller", () => {
  it("starts outside a callback and outside the fixed loop", () => {
    const controller = createFrameState();
    expect(controller.state.isInsideCallback).toBe(false);
    expect(controller.state.isInsideFixedStep).toBe(false);
  });

  it("nests callbacks", () => {
    const controller = createFrameState();
    controller.beginCallback();
    controller.beginCallback();
    controller.endCallback();
    expect(controller.state.isInsideCallback).toBe(true);
    controller.endCallback();
    expect(controller.state.isInsideCallback).toBe(false);
  });

  it("never goes below zero on an unbalanced end", () => {
    const controller = createFrameState();
    controller.endCallback();
    controller.endCallback();
    expect(controller.state.isInsideCallback).toBe(false);
    controller.beginCallback();
    expect(controller.state.isInsideCallback).toBe(true);
  });

  it("tracks the fixed loop", () => {
    const controller = createFrameState();
    controller.setInsideFixedStep(true);
    expect(controller.state.isInsideFixedStep).toBe(true);
    controller.setInsideFixedStep(false);
    expect(controller.state.isInsideFixedStep).toBe(false);
  });
});
