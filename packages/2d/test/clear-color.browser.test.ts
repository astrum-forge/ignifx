import { Camera, Color } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Camera2D } from "../src/camera/camera-2d.js";
import { createTwoDBrowserApp, distanceTo, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { TwoDBrowserApp } from "./support/browser-harness.js";
import type { ColorLike } from "@ignifx/core";

/**
 * What a `"sprite"`-mode frame is cleared to (`docs/architecture/11-2d-toolkit.md` §1,
 * `07-rendering.md` §2.1).
 *
 * A sprite pass opens its own swapchain pass and clears it, so nothing the render scene did
 * survives underneath and `RendererImpl.applyClearColor` — the whole of the 3D precedence order —
 * never reaches the screen in a 2D game. Only a real device can answer what colour comes out, which
 * is why the assertion lives here rather than in the node suite; `test/settings.test.ts` covers the
 * setting being read at all.
 *
 * ## The colour space, measured rather than assumed (2026-09-08, macOS arm64, SwiftShader)
 *
 * `rendering.clearColor` is sRGB, Lite's clear values are linear, and the surface is **not** an
 * sRGB-encoding format — so the decoded value is presented verbatim and a channel comes out at
 * `srgbToLinear(setting) * 255`, not at `setting * 255`. `{ r: 0.6, g: 0.2, b: 0.9 }` presents as
 * bytes `81, 8, 201`. That is the 3D path's behaviour, not a 2D quirk: the `"mixed"` case below
 * measures the same setting through `scene.clearColor` and gets the same three bytes, which is the
 * property that actually matters — one setting, one colour, whichever mode a game is in.
 */

let harness: TwoDBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** How far a channel may drift on SwiftShader and still count as the same colour. */
const TOLERANCE = 2;

/** The sRGB colour both apps configure, chosen so all three channels differ. */
const CLEAR: ColorLike = { r: 0.6, g: 0.2, b: 0.9, a: 1 };

/**
 * The byte a channel of {@link CLEAR} is expected to present as.
 *
 * @param channel - The sRGB channel, `0` to `1`.
 * @returns The presented byte.
 */
function presented(channel: number): number {
  return Math.round(Color.srgbToLinear(channel) * 255);
}

describe('"sprite" mode', () => {
  it("clears the frame to the configured rendering.clearColor rather than to black", async () => {
    const running = await createTwoDBrowserApp({
      width: 32,
      height: 32,
      options: { mode: "sprite", pixelsPerUnit: 16 },
      settings: { rendering: { msaaSamples: 1, clearColor: CLEAR } },
    });
    harness = running;
    running.world.createEntity("Camera").addComponent(Camera2D);
    await running.advance(SETTLE_FRAMES);

    const pixel = await running.centrePixel();
    expect(distanceTo(pixel, presented(CLEAR.r), presented(CLEAR.g), presented(CLEAR.b))).toBeLessThanOrEqual(
      TOLERANCE,
    );
    // The regression this covers: the sprite pass used to clear to a hard-coded black.
    expect(pixel.r + pixel.g + pixel.b).toBeGreaterThan(0);
    expect(pixel.a).toBe(255);
    expect(running.errors).toEqual([]);
  }, 60_000);

  it("presents the same colour the 3D path presents for the same setting", async () => {
    // `"mixed"` leaves the clear to the render scene (`clear: false` on the sprite pass), so this
    // is `RendererImpl.applyClearColor` measured through the same capture path.
    const running = await createTwoDBrowserApp({
      width: 32,
      height: 32,
      options: { mode: "mixed", pixelsPerUnit: 16 },
      settings: { rendering: { msaaSamples: 1, clearColor: CLEAR } },
    });
    harness = running;
    const eye = running.world.createEntity("Eye");
    eye.transform.localPosition.set(0, 0, -4);
    eye.addComponent(Camera);
    running.world.createEntity("Camera2D").addComponent(Camera2D);
    await running.advance(SETTLE_FRAMES);

    const pixel = await running.centrePixel();
    expect(distanceTo(pixel, presented(CLEAR.r), presented(CLEAR.g), presented(CLEAR.b))).toBeLessThanOrEqual(
      TOLERANCE,
    );
  }, 60_000);

  it("logs no IGX-0706 for a world whose only camera is a Camera2D", async () => {
    // Built before `app.start()`, which is the order every template and every recipe uses: a world
    // that is still empty when the loop starts has no camera of any kind, and warning about that is
    // right.
    const running = await createTwoDBrowserApp({
      width: 32,
      height: 32,
      options: { mode: "sprite" },
      autoStart: false,
    });
    harness = running;
    running.world.createEntity("Camera").addComponent(Camera2D);
    await running.start();
    await running.advance(SETTLE_FRAMES);

    expect(running.log.toArray().filter((record) => record.message.includes("IGX-0706"))).toEqual([]);
  }, 60_000);
});
