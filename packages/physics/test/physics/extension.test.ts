import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { BoxCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { physics } from "../../src/extension.js";
import { havokWasmBytes } from "../lite/fixtures/havok.js";
import type { App } from "@ignifx/core";

/**
 * Where the extension gets Havok from, and what it declares (`docs/architecture/09-physics.md` §7,
 * `04-extensions.md` §1). Each case builds a **real** app with a different source, because the
 * source is the one thing `physics()` decides before anything else can run.
 *
 * The bytes come from the shared fixture rather than the instantiated module: the point of this
 * suite is the bytes path, not the already-loaded one.
 */

/** One fixed step at the default rate. */
const FIXED_STEP = 1 / 60;

/**
 * Runs a box for a few steps and reports whether it fell.
 *
 * @param app - The started app.
 * @returns `true` when the box moved down.
 */
function fell(app: App): boolean {
  const box = app.world.createEntity("Box");
  box.transform.position = { x: 0, y: 4, z: 0 };
  box.addComponent(BoxCollider);
  box.addComponent(Rigidbody, { interpolation: "none" });
  for (let index = 0; index < 10; index += 1) {
    app.step(FIXED_STEP);
  }
  return box.transform.position.y < 4;
}

describe("physics() and its Havok source", () => {
  it("accepts explicit wasm bytes", async () => {
    const app = await createApp({
      headless: true,
      clock: createManualClock(),
      logSink: createMemorySink(),
      extensions: [physics({ wasmBinary: havokWasmBytes() })],
    });
    try {
      await app.start();
      expect(fell(app)).toBe(true);
    } finally {
      app.dispose();
    }
  }, 60_000);

  it("resolves the binary itself when the game hands it nothing", async () => {
    // The plain `physics()` a game writes: the address comes from the manifest, no server answers it
    // under Node, and the loader falls back to the installed `@babylonjs/havok` package.
    const app = await createApp({
      headless: true,
      clock: createManualClock(),
      logSink: createMemorySink(),
      extensions: [physics()],
    });
    try {
      await app.start();
      expect(fell(app)).toBe(true);
      expect(app.physics.lite.world).toBeDefined();
    } finally {
      app.dispose();
    }
  }, 60_000);

  it("registers the settings section, the loader, and the error codes before onStart", async () => {
    const app = await createApp({
      headless: true,
      clock: createManualClock(),
      logSink: createMemorySink(),
      extensions: [physics()],
    });
    try {
      // `register` runs inside `createApp`, so everything it declares exists before `start()`.
      expect(app.settings.section("physics")).toBeDefined();
      expect(app.assets.resolveUrl("HavokPhysics.wasm")).toBe("assets/HavokPhysics.wasm");
      await app.start();
    } finally {
      app.dispose();
    }
  }, 60_000);
});
