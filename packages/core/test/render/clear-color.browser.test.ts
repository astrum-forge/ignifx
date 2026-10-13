import { afterEach, describe, expect, it } from "vitest";
import { Environment } from "../../src/render/environment.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { addCameraAndLight, createBrowserApp, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { PixelRgba } from "../../src/lite/screenshot.js";
import type { ColorLike } from "../../src/math/types.js";

/**
 * The clear colour presents as authored, through the scene's image processing
 * (`docs/architecture/07-rendering.md` §2.1).
 *
 * Every clear colour is sRGB. With no image processing an sRGB `0.5` has to read back as byte `128`,
 * whichever of the three writers set it and whatever else the frame does. Under a tone-mapping
 * curve it goes through the same exposure, curve and contrast as a fully fogged PBR fragment, so
 * under ACES `0.5` presents as byte `104` — and the fogged floor and the sky meet with no band.
 * Before 0.5.0 the value was decoded to linear and never re-encoded (byte `55`); in 0.5.0 it skipped
 * image processing (byte `128` under ACES, beside a fogged floor at `104`).
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

/** The byte an sRGB `0.5` presents as with no image processing. */
const EXPECTED = 128;

/** The byte an sRGB `0.5` presents as under ACES at exposure 1 and contrast 1: `0.4077 * 255`. */
const EXPECTED_ACES = 104;

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
    // Every other bloom field keeps its schema default (threshold 0.9).
    camera.entity.addComponent(PostProcessStack, { bloom: { enabled: true } });
  }
  await running.start();
  await running.advance(SETTLE_FRAMES * 2);
  return running.pixelAt(1, 1);
}

/**
 * Asserts that a pixel is the authored grey, as the frame's image processing presents it.
 *
 * @param pixel - The presented pixel.
 * @param expected - The byte every channel should read.
 */
function expectAuthoredGrey(pixel: PixelRgba, expected = EXPECTED): void {
  const read = `presented ${String(pixel.r)}, ${String(pixel.g)}, ${String(pixel.b)}`;
  expect(Math.abs(pixel.r - expected), read).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(pixel.g - expected), read).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(pixel.b - expected), read).toBeLessThanOrEqual(TOLERANCE);
}

describe("an sRGB clear colour of 0.5", () => {
  const writers: readonly Writer[] = ["setting", "camera", "environment"];
  const paths: readonly FramePath[] = ["plain", "aces", "bloom"];
  for (const writer of writers) {
    for (const path of paths) {
      const expected = path === "aces" ? EXPECTED_ACES : EXPECTED;
      it(`presents as byte ${String(expected)} when the ${writer} sets it (${path} frame)`, async () => {
        expectAuthoredGrey(await presentedClear(writer, path), expected);
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

describe("a clear colour under tone mapping", () => {
  it("matches a fully fogged floor of the same colour, within 3 bytes", async () => {
    const sky: ColorLike = { r: 0.35, g: 0.45, b: 0.6, a: 1 };
    const running = await createBrowserApp({ size: 32, startEmpty: false });
    harness = running;
    addCameraAndLight(running, 4);
    running.world.createEntity("Environment").addComponent(Environment, {
      imageProcessing: { exposure: 1, contrast: 1, toneMapping: "aces" },
      // Full strength from 1 m: the box, 3 m from the camera, is nothing but fog.
      fog: { mode: "linear", color: sky, density: 0, start: 0.5, end: 1 },
      clearColor: sky,
    });
    const white = createMaterialAsset(
      running.app,
      pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
      [],
    );
    running.world
      .createEntity("Fogged")
      .addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 2 }), materials: [white] });
    await running.start();
    await running.advance(SETTLE_FRAMES * 2);

    const fogged = await running.pixelAt(16, 16);
    const background = await running.pixelAt(1, 1);
    const read = `fogged ${String(fogged.r)}, ${String(fogged.g)}, ${String(fogged.b)}; clear ${String(background.r)}, ${String(background.g)}, ${String(background.b)}`;
    expect(Math.abs(fogged.r - background.r), read).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(fogged.g - background.g), read).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(fogged.b - background.b), read).toBeLessThanOrEqual(TOLERANCE);
    // And it is the tone-mapped colour, not the authored one.
    expect(background.b, read).toBeLessThan(Math.round(sky.b * 255) - TOLERANCE);
    expect(running.errors).toEqual([]);
  }, 60_000);

  it("follows a change of curve at runtime", async () => {
    expectAuthoredGrey(await presentedClear("setting", "aces"), EXPECTED_ACES);
    const environment = harness?.world.components(Environment)[0];
    expect(environment).toBeDefined();
    if (environment !== undefined) {
      environment.imageProcessing.toneMapping = "none";
    }
    await harness?.advance(SETTLE_FRAMES * 2);
    const pixel = await harness?.pixelAt(1, 1);
    expect(pixel).toBeDefined();
    if (pixel !== undefined) {
      expectAuthoredGrey(pixel, EXPECTED);
    }
  }, 60_000);
});
