import { afterEach, describe, expect, it } from "vitest";
import { defineInputActions } from "../../src/index.js";
import { createInputApp, demoActions } from "../support/app.js";
import type { InputActionEvent } from "../../src/index.js";
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

describe("action lookup", () => {
  it("finds an action in an enabled map", async () => {
    const { app } = await withDemo();
    expect(app.input.actions.get("jump").name).toBe("jump");
  });

  it("throws IGX-0801 for an action no enabled map declares", async () => {
    const { app } = await withDemo();
    let code = "";
    try {
      app.input.actions.get("submit");
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0801");
  });

  it("finds an action in a disabled map once the map is enabled", async () => {
    const { app } = await withDemo();
    app.input.actions.map("UI").enabled = true;
    expect(app.input.actions.get("submit").name).toBe("submit");
  });

  it("throws IGX-0801 for an action no map declares", async () => {
    const { app } = await withDemo();
    let code = "";
    try {
      app.input.actions.get("teleport");
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0801");
  });

  it("throws IGX-0804 for an unknown map", async () => {
    const { app } = await withDemo();
    let code = "";
    try {
      app.input.actions.map("Vehicle");
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0804");
  });

  it("finds an action in a disabled map through find()", async () => {
    const { app } = await withDemo();
    expect(app.input.actions.find("submit")?.name).toBe("submit");
    expect(app.input.actions.find("teleport")).toBeNull();
  });

  it("throws IGX-0801 from a map that does not declare the action", async () => {
    const { app } = await withDemo();
    let code = "";
    try {
      app.input.actions.map("Player").get("submit");
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0801");
  });

  it("rejects a document that declares one action name twice with IGX-0810", async () => {
    const built = await createInputApp();
    const { app } = built;
    harness = built;
    let code = "";
    try {
      app.input.loadActions(
        defineInputActions({
          maps: [
            {
              name: "Player",
              actions: [
                { name: "jump", bindings: [{ path: "<Keyboard>/space" }] },
                { name: "jump", bindings: [{ path: "<Keyboard>/enter" }] },
              ],
            },
          ],
        }),
      );
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0810");
  });
});

describe("action types", () => {
  it("reads a button as a boolean", async () => {
    const { app, step } = await withDemo();
    const jump = app.input.actions.get("jump");
    expect(jump.value).toBe(false);
    app.input.simulate({ "<Keyboard>/space": 1 });
    step();
    expect(jump.value).toBe(true);
    expect(jump.isPressed).toBe(true);
  });

  it("reads a 2DVector composite as a unit-ish vector", async () => {
    const { app, step } = await withDemo();
    const move = app.input.actions.get("move");
    app.input.simulate({ "<Keyboard>/w": 1, "<Keyboard>/d": 1 });
    step();
    expect(move.vector.x).toBe(1);
    expect(move.vector.y).toBe(1);
    expect(move.value).toBe(move.vector);
  });

  it("reads a 1DAxis composite as a signed scalar", async () => {
    const { app, step } = await withDemo();
    const throttle = app.input.actions.get("throttle");
    app.input.simulate({ "<Keyboard>/s": 1 });
    step();
    expect(throttle.axis).toBe(-1);
    expect(throttle.value).toBe(-1);
    app.input.simulate({ "<Keyboard>/s": 0, "<Keyboard>/w": 1 });
    step();
    expect(throttle.axis).toBe(1);
  });

  it("keeps the vector view live rather than copying it", async () => {
    const { app, step } = await withDemo();
    const move = app.input.actions.get("move");
    const view = move.vector;
    app.input.simulate({ "<Keyboard>/d": 1 });
    step();
    expect(view.x).toBe(1);
    app.input.simulate({ "<Keyboard>/d": 0 });
    step();
    expect(view.x).toBe(0);
  });

  it("takes the highest-magnitude binding when several are actuated", async () => {
    const { app, step } = await withDemo();
    const move = app.input.actions.get("move");
    app.input.simulate({ "<Keyboard>/d": 1, "<Gamepad>/leftStick": { x: 0.5, y: 0 } });
    step();
    expect(move.vector.x).toBe(1);
    app.input.simulate({ "<Keyboard>/d": 0 });
    step();
    expect(move.vector.x).toBeCloseTo((0.5 - 0.15) / 0.85, 5);
  });
});

describe("the press point", () => {
  it("turns an analog value into button state at the configured threshold", async () => {
    const built = await createInputApp();
    harness = built;
    built.app.input.loadActions(
      defineInputActions({
        maps: [
          {
            name: "Player",
            actions: [{ name: "gas", type: "axis", bindings: [{ path: "<Gamepad>/rightTrigger" }] }],
          },
        ],
      }),
    );
    const gas = built.app.input.actions.get("gas");
    built.app.input.simulate({ "<Gamepad>/rightTrigger": 0.4 });
    built.step();
    expect(gas.isPressed).toBe(false);
    built.app.input.simulate({ "<Gamepad>/rightTrigger": 0.6 });
    built.step();
    expect(gas.isPressed).toBe(true);
    built.app.input.pressPoint = 0.8;
    built.step();
    expect(gas.isPressed).toBe(false);
  });

  it("takes its default from the input settings section", async () => {
    const built = await createInputApp({ settings: { input: { pressPoint: 0.25 } } });
    harness = built;
    expect(built.app.input.pressPoint).toBe(0.25);
  });
});

describe("disabled maps and actions", () => {
  it("reads an action in a disabled map as released", async () => {
    const { app, step } = await withDemo();
    app.input.actions.map("UI").enabled = true;
    const submit = app.input.actions.get("submit");
    app.input.simulate({ "<Keyboard>/enter": 1 });
    step();
    expect(submit.isPressed).toBe(true);
    app.input.actions.map("UI").enabled = false;
    step();
    expect(submit.isPressed).toBe(false);
    expect(submit.wasReleasedThisFrame).toBe(true);
  });

  it("reads a disabled action as released", async () => {
    const { app, step } = await withDemo();
    const jump = app.input.actions.get("jump");
    jump.enabled = false;
    app.input.simulate({ "<Keyboard>/space": 1 });
    step();
    expect(jump.isPressed).toBe(false);
    jump.enabled = true;
    step();
    expect(jump.isPressed).toBe(true);
  });
});

describe("action signals", () => {
  it("delivers started, performed, and canceled in that order", async () => {
    const { app, step } = await withDemo();
    const jump = app.input.actions.get("jump");
    const log: string[] = [];
    jump.onStarted.connect((event: InputActionEvent) => log.push(`started:${String(event.magnitude)}`));
    jump.onPerformed.connect(() => log.push("performed"));
    jump.onCanceled.connect(() => log.push("canceled"));
    app.input.simulate({ "<Keyboard>/space": 1 });
    step();
    expect(log).toEqual(["started:1", "performed"]);
    app.input.simulate({ "<Keyboard>/space": 0 });
    step();
    expect(log).toEqual(["started:1", "performed", "canceled"]);
  });

  it("emits performed again when a held value changes", async () => {
    const { app, step } = await withDemo();
    const move = app.input.actions.get("move");
    let performed = 0;
    move.onPerformed.connect(() => {
      performed += 1;
    });
    app.input.simulate({ "<Keyboard>/d": 1 });
    step();
    app.input.simulate({ "<Keyboard>/w": 1 });
    step();
    expect(performed).toBe(2);
  });

  it("resolves actions in the arrival order of the events that actuated them", async () => {
    const { app, step } = await withDemo();
    const log: string[] = [];
    app.input.actions.get("jump").onStarted.connect(() => log.push("jump"));
    app.input.actions.get("move").onStarted.connect(() => log.push("move"));
    app.input.simulate({ "<Keyboard>/space": 1 });
    app.input.simulate({ "<Keyboard>/d": 1 });
    step();
    expect(log).toEqual(["jump", "move"]);
  });

  it("reverses the order when the events arrive the other way round", async () => {
    const { app, step } = await withDemo();
    const log: string[] = [];
    app.input.actions.get("jump").onStarted.connect(() => log.push("jump"));
    app.input.actions.get("move").onStarted.connect(() => log.push("move"));
    app.input.simulate({ "<Keyboard>/d": 1 });
    app.input.simulate({ "<Keyboard>/space": 1 });
    step();
    expect(log).toEqual(["move", "jump"]);
  });

  it("reports a handler exception through app.onError instead of throwing", async () => {
    const { app, step } = await withDemo();
    const reported: string[] = [];
    app.onError.connect((report) => reported.push(report.source));
    app.input.actions.get("jump").onStarted.connect(() => {
      throw new Error("handler");
    });
    app.input.simulate({ "<Keyboard>/space": 1 });
    step();
    expect(reported).toEqual(["system"]);
  });

  it("applies a press and a release in the same frame in arrival order", async () => {
    const { app, step } = await withDemo();
    const jump = app.input.actions.get("jump");
    app.input.simulateEvent({ type: "keydown", code: "space" });
    app.input.simulateEvent({ type: "keyup", code: "space" });
    step();
    expect(jump.isPressed).toBe(false);
    expect(jump.wasPressedThisFrame).toBe(false);
  });
});
