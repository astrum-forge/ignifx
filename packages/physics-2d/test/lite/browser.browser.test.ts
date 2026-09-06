import { createApp, createManualClock } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { BoxCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { physics2d } from "../../src/extension.js";

/**
 * The browser smoke test: `physics2d()` initialises inside Chromium and a box falls onto a floor.
 *
 * Rapier is pure WebAssembly with its binary inlined by the `-compat` build, so nothing has to be
 * served and the browser path is the Node path — which is exactly what this proves.
 */

/** The fixed step the smoke test runs at. */
const STEP = 1 / 60;

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

describe("@ignifx/physics-2d in a browser", () => {
  it("instantiates Rapier and simulates a falling box", async () => {
    const clock = createManualClock();
    const app = await createApp({ headless: true, clock, extensions: [physics2d()] });
    try {
      await app.start();
      const floor = app.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });

      const crate = app.world.createEntity("Crate");
      crate.transform.position = { x: 0, y: 5, z: 0 };
      crate.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      crate.addComponent(Rigidbody2D, { interpolation: "none" });

      for (let index = 0; index < 240; index += 1) {
        clock.advance(STEP * MILLISECONDS_PER_SECOND);
        app.step(STEP);
      }
      expect(crate.transform.position.y).toBeGreaterThan(0.4);
      expect(crate.transform.position.y).toBeLessThan(0.6);
      expect(app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20)?.entity.name).toBe("Crate");
    } finally {
      app.dispose();
    }
  }, 60_000);
});
