import { afterEach, describe, expect, it } from "vitest";
import { controlPath, INPUT_OVERRIDES_FORMAT } from "../../src/index.js";
import { createInputApp, demoActions, required } from "../support/app.js";
import type { InputOverridesJson } from "../../src/index.js";
import type { InputAppHarness } from "../support/app.js";
import type { IgnifxError } from "@ignifx/core";

let harness: InputAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Builds a headless app with the demo document installed. */
async function withDemo(): Promise<InputAppHarness> {
  const built = await createInputApp();
  built.app.input.loadActions(demoActions());
  harness = built;
  return built;
}

describe("binding overrides", () => {
  it("replaces the control a binding reads", async () => {
    const { app, step } = await withDemo();
    const jump = app.input.actions.get("jump");
    required(jump.bindings[0], "binding 0").overridePath = "<Keyboard>/enter";
    expect(required(jump.bindings[0], "binding 0").effectivePath).toBe("<Keyboard>/enter");
    app.input.simulate({ "<Keyboard>/space": 1 });
    step();
    expect(jump.isPressed).toBe(false);
    app.input.simulate({ "<Keyboard>/space": 0, "<Keyboard>/enter": 1 });
    step();
    expect(jump.isPressed).toBe(true);
  });

  it("returns to the declared path when the override is cleared", async () => {
    const { app, step } = await withDemo();
    const jump = app.input.actions.get("jump");
    required(jump.bindings[0], "binding 0").overridePath = "<Keyboard>/enter";
    required(jump.bindings[0], "binding 0").overridePath = null;
    expect(required(jump.bindings[0], "binding 0").effectivePath).toBe("<Keyboard>/space");
    app.input.simulate({ "<Keyboard>/space": 1 });
    step();
    expect(jump.isPressed).toBe(true);
  });

  it("keeps the previous override when the new path does not resolve", async () => {
    const { app } = await withDemo();
    const binding = required(app.input.actions.get("jump").bindings[0], "binding 0");
    binding.overridePath = "<Keyboard>/enter";
    let code = "";
    try {
      binding.overridePath = "<Keyboard>/nope";
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0803");
    expect(binding.effectivePath).toBe("<Keyboard>/enter");
  });

  it("round-trips through saveOverrides and loadOverrides", async () => {
    const { app } = await withDemo();
    required(app.input.actions.get("jump").bindings[0], "binding 0").overridePath = "<Keyboard>/enter";
    required(app.input.actions.get("jump").bindings[1], "binding 1").overridePath = "<Gamepad>/buttonEast";
    const saved = app.input.saveOverrides();
    expect(saved.format).toBe(INPUT_OVERRIDES_FORMAT);
    expect(saved.overrides).toEqual([
      { map: "Player", action: "jump", bindingIndex: 0, path: "<Keyboard>/enter" },
      { map: "Player", action: "jump", bindingIndex: 1, path: "<Gamepad>/buttonEast" },
    ]);
    app.input.clearOverrides();
    expect(app.input.saveOverrides().overrides).toEqual([]);
    app.input.loadOverrides(saved);
    expect(app.input.saveOverrides()).toEqual(saved);
    expect(required(app.input.actions.get("jump").bindings[0], "binding 0").effectivePath).toBe("<Keyboard>/enter");
  });

  it("survives a JSON round trip", async () => {
    const { app } = await withDemo();
    required(app.input.actions.get("jump").bindings[0], "binding 0").overridePath = "<Keyboard>/enter";
    const text = JSON.stringify(app.input.saveOverrides());
    app.input.clearOverrides();
    app.input.loadOverrides(JSON.parse(text) as InputOverridesJson);
    expect(required(app.input.actions.get("jump").bindings[0], "binding 0").effectivePath).toBe("<Keyboard>/enter");
  });

  it("rejects a document that is not ignifx.inputoverrides with IGX-0808", async () => {
    const { app } = await withDemo();
    let code = "";
    try {
      app.input.loadOverrides({ format: "ignifx.scene", formatVersion: 1, overrides: [] });
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0808");
  });

  it("rejects an override naming a binding that no longer exists", async () => {
    const { app } = await withDemo();
    let code = "";
    try {
      app.input.loadOverrides({
        format: INPUT_OVERRIDES_FORMAT,
        formatVersion: 1,
        overrides: [{ map: "Player", action: "jump", bindingIndex: 9, path: "<Keyboard>/enter" }],
      });
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0808");
  });
});

describe("interactive rebinding", () => {
  it("binds to the control the player actuates and settles at the delivery point", async () => {
    const { app, step } = await withDemo();
    const jump = app.input.actions.get("jump");
    const pending = app.input.performInteractiveRebind(jump, { bindingIndex: 0 });
    step();
    app.input.simulate({ "<Keyboard>/enter": 1 });
    step();
    const result = await pending;
    expect(result.path).toBe("<Keyboard>/enter");
    expect(result.canceled).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(required(jump.bindings[0], "binding 0").overridePath).toBe("<Keyboard>/enter");
  });

  it("takes the highest-magnitude actuation within the frame", async () => {
    const { app, step } = await withDemo();
    const pending = app.input.performInteractiveRebind(app.input.actions.get("jump"));
    app.input.simulate({ "<Gamepad>/leftTrigger": 0.6, "<Gamepad>/rightTrigger": 0.9 });
    step();
    expect((await pending).path).toBe("<Gamepad>/rightTrigger");
  });

  it("refuses to bind an excluded path", async () => {
    const { app, step } = await withDemo();
    const pending = app.input.performInteractiveRebind(app.input.actions.get("jump"), {
      excludePaths: ["<Keyboard>/enter"],
    });
    app.input.simulate({ "<Keyboard>/enter": 1 });
    step();
    app.input.simulate({ "<Keyboard>/enter": 0, "<Keyboard>/tab": 1 });
    step();
    expect((await pending).path).toBe("<Keyboard>/tab");
  });

  it("cancels on the cancel path without writing an override", async () => {
    const { app, step } = await withDemo();
    const jump = app.input.actions.get("jump");
    const pending = app.input.performInteractiveRebind(jump, { cancelPath: "<Keyboard>/escape" });
    app.input.simulate({ "<Keyboard>/escape": 1 });
    step();
    const result = await pending;
    expect(result.canceled).toBe(true);
    expect(result.path).toBeNull();
    expect(required(jump.bindings[0], "binding 0").overridePath).toBeNull();
  });

  it("times out after the configured unscaled seconds", async () => {
    const { app, step } = await withDemo();
    const pending = app.input.performInteractiveRebind(app.input.actions.get("jump"), { timeoutSeconds: 0.1 });
    step(0.05);
    step(0.06);
    const result = await pending;
    expect(result.timedOut).toBe(true);
    expect(result.path).toBeNull();
  });

  it("ignores continuous controls such as the pointer position", async () => {
    const { app, step } = await withDemo();
    const pending = app.input.performInteractiveRebind(app.input.actions.get("jump"), { timeoutSeconds: 0.05 });
    app.input.simulateEvent({ type: "pointermove", x: 500, y: 400, deltaX: 30, deltaY: 30 });
    step(0.02);
    step(0.05);
    expect((await pending).timedOut).toBe(true);
  });

  it("rejects a second rebind while one is listening with IGX-0807", async () => {
    const { app, step } = await withDemo();
    const jump = app.input.actions.get("jump");
    const pending = app.input.performInteractiveRebind(jump);
    await expect(app.input.performInteractiveRebind(jump)).rejects.toMatchObject({ code: "IGX-0807" });
    app.input.cancelInteractiveRebind();
    step();
    expect((await pending).canceled).toBe(true);
  });

  it("cancels a rebind in flight when the app is disposed", async () => {
    const built = await withDemo();
    const pending = built.app.input.performInteractiveRebind(built.app.input.actions.get("jump"));
    built.dispose();
    harness = null;
    expect((await pending).canceled).toBe(true);
  });

  it("cancelling with nothing in flight is a no-op", async () => {
    const { app } = await withDemo();
    expect(() => app.input.cancelInteractiveRebind()).not.toThrow();
  });
});

describe("control paths", () => {
  it("writes the slot only when it is not zero", async () => {
    const { app } = await withDemo();
    const pad0 = required(app.input.gamepads[0], "gamepad slot 0");
    const pad2 = required(app.input.gamepads[2], "gamepad slot 2");
    expect(controlPath(pad0, required(pad0.control("buttonSouth"), "buttonSouth"))).toBe("<Gamepad>/buttonSouth");
    expect(controlPath(pad2, required(pad2.control("buttonSouth"), "buttonSouth"))).toBe("<Gamepad>{2}/buttonSouth");
  });
});
