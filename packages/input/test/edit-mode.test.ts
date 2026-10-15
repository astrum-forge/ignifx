import { describe, expect, it } from "vitest";
import { createInputApp, demoActions } from "./support/app.js";

/**
 * `@ignifx/input` in an edit-mode app (ADR-0028): the resolve system keeps running, so a tool
 * script that runs in edit mode can read actions.
 */

describe("input in an edit-mode app", () => {
  it("resolves an action from device state", async () => {
    const harness = await createInputApp({ editMode: true });
    try {
      harness.app.input.loadActions(demoActions());
      harness.app.input.simulate({ "<Keyboard>/space": 1 });
      harness.step();
      expect(harness.app.input.actions.get("jump").isPressed).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
