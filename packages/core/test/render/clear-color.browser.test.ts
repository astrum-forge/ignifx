import { afterEach, describe, expect, it } from "vitest";
import { Environment } from "../../src/render/environment.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { addCameraAndLight, createBrowserApp, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { PixelRgba } from "../../src/lite/screenshot.js";
import type { ColorLike } from "../../src/math/types.js";

/**
 * The clear colour presents as authored (`docs/architecture/07-rendering.md` §2.1).
 *
 * Every clear colour is sRGB, and the frame lands on the swapchain byte for byte: an sRGB `0.5` has
 * to read back as byte `128`, whichever of the three writers set it and whatever else the frame
 * does. Before 0.5.0 the value was decoded to linear on the way to Lite and nothing re-encoded it,
 * so `0.5` presented as byte `55`.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The sRGB mid grey every case authors. */
const GREY: ColorLike = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

/** A colour the setting is given when a component is the writer under test, so a miss is visible. */
const RED: ColorLike = { r: 1, g: 0, b: 0, a: 1 };

/** The byte an sRGB `0.5` presents as. */
const EXPECTED = 128;

/** How far a channel may drift on SwiftShader and still count as the authored byte. */
const TOLERANCE = 3;

/** Which of the three writers sets the clear colour. */
type Writer = "setting" | "camera" | "environment";

/** What else the frame does on its way to the swapchain. */
type FramePath = "plain" | "aces" | "bloom";

/**
 * Builds an empty scene whose clear colour is set by `writer`, renders a few frames, and reads a
 * background pixel.
 *
 * @param writer - Which writer sets the grey.
 * @param path - `"aces"` adds an `Environment` tone mapping with ACES; `"bloom"` renders through the
 * offscreen path with a `PostProcessStack` running bloom.
 * @param srgb - Whether the surface renders through an sRGB view.
 * @returns The presented background pixel.
 */
async function presentedClear(writer: Writer, path: FramePath, srgb = false): Promise<PixelRgba> {
  const running = await createBrowserApp({
    size: 32,
    startEmpty: false,
    settings: {
      rendering: {
        srgb,
        clearColor: writer === "setting" ? GREY : RED,
        features: { postProcessing: path === "bloom" },
      },
    },
  });
  harness = running;
  const camera = addCameraAndLight(running, 4);
  if (writer === "camera") {
    camera.clearColor = GREY;
  }
  if (writer === "environment" || path === "aces") {
    running.world.createEntity("Environment").addComponent(Environment, {
      imageProcessing: { exposure: 1, contrast: 1, toneMapping: path === "aces" ? "aces" : "none" },
      clearColor: writer === "environment" ? GREY : null,
    });
  }
  if (path === "bloom") {
    // Switched on in place so every other bloom field keeps its schema default (threshold 0.9).
    camera.entity.addComponent(PostProcessStack).bloom.enabled = true;
  }
  await running.start();
  await running.advance(SETTLE_FRAMES * 2);
  return running.pixelAt(1, 1);
}

/**
 * Asserts that a pixel is the authored grey.
 *
 * @param pixel - The presented pixel.
 */
function expectAuthoredGrey(pixel: PixelRgba): void {
  const read = `presented ${String(pixel.r)}, ${String(pixel.g)}, ${String(pixel.b)}`;
  expect(Math.abs(pixel.r - EXPECTED), read).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(pixel.g - EXPECTED), read).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(pixel.b - EXPECTED), read).toBeLessThanOrEqual(TOLERANCE);
}

describe("an sRGB clear colour of 0.5", () => {
  const writers: readonly Writer[] = ["setting", "camera", "environment"];
  const paths: readonly FramePath[] = ["plain", "aces", "bloom"];
  for (const writer of writers) {
    for (const path of paths) {
      it(`presents as byte 128 when the ${writer} sets it (${path} frame)`, async () => {
        expectAuthoredGrey(await presentedClear(writer, path));
        expect(harness?.errors).toEqual([]);
      }, 60_000);
    }
  }

  it("presents as byte 128 through an sRGB surface view, which encodes on write", async () => {
    expectAuthoredGrey(await presentedClear("setting", "plain", true));
  }, 60_000);

  it("presents as byte 128 through an sRGB surface view with a bloom chain", async () => {
    expectAuthoredGrey(await presentedClear("camera", "bloom", true));
  }, 60_000);
});
