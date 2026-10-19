import {
  addToScene,
  createBox,
  createSpriteRenderer,
  createStandardMaterial,
  createTextRenderer,
  getRenderingContexts,
  registerSpriteRenderer,
  registerTextRenderer,
} from "@babylonjs/lite";
import { afterEach, describe, expect, it } from "vitest";
import { createMaterialAsset, pbrMaterialDefinition } from "../../../src/render/material-asset.js";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import { PostProcessStack } from "../../../src/render/post-process-stack.js";
import {
  addCameraAndLight,
  createBrowserApp,
  gpuDeviceErrors,
  nextFrame,
  SETTLE_FRAMES,
} from "../../render/support/browser-harness.js";
import type { PixelRgba } from "../../../src/lite/screenshot.js";
import type { RenderOverlay } from "../../../src/render/renderer.js";
import type { BrowserApp } from "../../render/support/browser-harness.js";

/**
 * `app.renderer.openOverlay()` (`docs/architecture/07-rendering.md` §2.10, ADR-0031).
 *
 * The scene is a red box at the origin, seen by a camera 4 m back, on a grey clear colour. The
 * overlay holds a smaller green box **behind** the red one: in the render scene it would be hidden,
 * so a green centre proves the overlay drew over the frame with a depth buffer of its own. A red
 * pixel beside it and a grey corner prove the render scene was not blacked out (editor spike S0.2
 * §3.2). Every case runs at MSAA 1 and 4, on the plain path and on the post-processing path, whose
 * render scene resolves into an offscreen target and presents through `ignifx:present`.
 *
 * This file lives under `test/lite/**` because it fills the overlay with Lite meshes, as an editor
 * does, and registers Lite text and sprite renderers the way `@ignifx/ui` and `@ignifx/2d` do.
 */

let harness: BrowserApp | null = null;
let deviceErrors: ReturnType<typeof gpuDeviceErrors> | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
  deviceErrors?.stop();
  deviceErrors = null;
});

/** The canvas edge. */
const SIZE = 64;

/** The clear colour, in sRGB. */
const GREY = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

/** A pixel on the red box, outside the green one (the red box spans about 13-51, the green 24-40). */
const BESIDE = { x: SIZE >> 1, y: 16 };

/** A pixel on neither box. */
const CORNER = { x: 1, y: 1 };

/** The render paths. */
type FramePath = "plain" | "postProcessing";

/** One case: an MSAA setting and a render path. */
interface Case {
  /** `rendering.msaaSamples`. */
  readonly msaa: 1 | 4;
  /** The render path. */
  readonly path: FramePath;
}

const CASES: readonly Case[] = [
  { msaa: 1, path: "plain" },
  { msaa: 4, path: "plain" },
  { msaa: 1, path: "postProcessing" },
  { msaa: 4, path: "postProcessing" },
];

/**
 * Starts the red-box scene.
 *
 * @param scenario - The MSAA setting and render path.
 * @returns The running app.
 */
async function startScene(scenario: Case): Promise<BrowserApp> {
  deviceErrors = gpuDeviceErrors();
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: {
      rendering: {
        msaaSamples: scenario.msaa,
        clearColor: GREY,
        features: { postProcessing: scenario.path === "postProcessing" },
      },
    },
  });
  harness = running;
  const camera = addCameraAndLight(running, 4);
  if (scenario.path === "postProcessing") {
    // The stack adds no effect, so the frame reaches the swapchain through `ignifx:present`.
    camera.entity.addComponent(PostProcessStack, {});
  }
  const red = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 0, b: 0, a: 1 }, unlit: true }),
    [],
  );
  running.world
    .createEntity("Red box")
    .addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 2 }), materials: [red] });
  await running.start();
  await running.advance(SETTLE_FRAMES);
  return running;
}

/**
 * Adds a green box to the overlay, 2 m behind the red box's centre.
 *
 * @param running - The running app.
 * @param overlay - The open overlay.
 */
function addGreenBox(running: BrowserApp, overlay: RenderOverlay): void {
  const box = createBox(running.renderer.engine, { size: 1.5 });
  const material = createStandardMaterial();
  material.diffuseColor = [0, 0, 0];
  material.specularColor = [0, 0, 0];
  material.emissiveColor = [0, 1, 0];
  box.material = material;
  box.position.set(0, 0, 2);
  addToScene(overlay.lite.scene, box);
}

/**
 * Asserts which colour channel dominates a pixel.
 *
 * @param pixel - The presented pixel.
 * @param channel - The channel that must lead the other two by a wide margin.
 */
function expectDominant(pixel: PixelRgba, channel: "r" | "g"): void {
  const other = channel === "r" ? pixel.g : pixel.r;
  const read = `presented ${String(pixel.r)}, ${String(pixel.g)}, ${String(pixel.b)}`;
  expect(pixel[channel], read).toBeGreaterThan(150);
  expect(other, read).toBeLessThan(80);
  expect(pixel.b, read).toBeLessThan(80);
}

/**
 * Asserts the clear colour shows, so the render scene's frame was kept.
 *
 * @param pixel - The presented pixel.
 */
function expectGrey(pixel: PixelRgba): void {
  const read = `presented ${String(pixel.r)}, ${String(pixel.g)}, ${String(pixel.b)}`;
  for (const value of [pixel.r, pixel.g, pixel.b]) {
    expect(Math.abs(value - 128), read).toBeLessThanOrEqual(4);
  }
}

/**
 * Asserts the frame shows the overlay over an intact render scene.
 *
 * @param running - The running app.
 */
async function expectOverlayOverScene(running: BrowserApp): Promise<void> {
  expectDominant(await running.centrePixel(), "g");
  expectDominant(await running.pixelAt(BESIDE.x, BESIDE.y), "r");
  expectGrey(await running.pixelAt(CORNER.x, CORNER.y));
}

/**
 * Disposes the app a number of microtasks into an `openOverlay()` call, and asserts that the call
 * either rejected with `IGX-0106` or returned an overlay that was disposed, and that nothing stays
 * registered on the engine.
 *
 * @param ticks - How many microtasks pass between the call and `app.dispose()`.
 */
async function disposeWhileOpening(ticks: number): Promise<void> {
  const running = await startScene({ msaa: 4, path: "plain" });
  // Loaded once, so the next call reaches the registration within a few microtasks.
  (await running.app.renderer.openOverlay()).dispose();
  const engine = running.renderer.engine;
  const pending = running.app.renderer.openOverlay();
  await Array.from({ length: ticks }).reduce<Promise<void>>((chain) => chain.then(() => undefined), Promise.resolve());
  running.dispose();
  harness = null;
  const settled: unknown = await pending.then(
    (overlay) => overlay,
    (error: unknown) => error,
  );
  if (typeof settled === "object" && settled !== null && "lite" in settled) {
    expect((settled as RenderOverlay).lite.scene.camera).toBeNull();
  } else {
    expect(settled).toMatchObject({ code: "IGX-0106" });
  }
  await nextFrame();
  expect(getRenderingContexts(engine)).toEqual([]);
}

/** Asserts the device reported no validation error, which would mean a rejected frame. */
function expectNoDeviceErrors(): void {
  expect(deviceErrors?.errors).toEqual([]);
}

describe("a render overlay", () => {
  for (const scenario of CASES) {
    const label = `MSAA ${String(scenario.msaa)}, ${scenario.path} path`;

    it(`draws over the frame and keeps the scene (${label})`, async () => {
      const running = await startScene(scenario);
      expectDominant(await running.centrePixel(), "r");
      const overlay = await running.app.renderer.openOverlay();
      addGreenBox(running, overlay);
      await running.advance(SETTLE_FRAMES);

      await expectOverlayOverScene(running);
      expect(running.errors).toEqual([]);
      expectNoDeviceErrors();
    }, 60_000);

    it(`keeps the scene when a text renderer was registered first, as @ignifx/ui does (${label})`, async () => {
      const running = await startScene(scenario);
      registerTextRenderer(createTextRenderer(running.renderer.engine, { layers: [], clear: false }));
      await running.advance(2);
      const overlay = await running.app.renderer.openOverlay();
      addGreenBox(running, overlay);
      await running.advance(SETTLE_FRAMES);

      await expectOverlayOverScene(running);
      expectNoDeviceErrors();
    }, 60_000);
  }

  it("moves itself after a rendering context registered later, which would otherwise draw over it", async () => {
    const running = await startScene({ msaa: 4, path: "postProcessing" });
    const overlay = await running.app.renderer.openOverlay();
    addGreenBox(running, overlay);
    await running.advance(SETTLE_FRAMES);
    // A sprite renderer that clears, as `@ignifx/2d` registers in "sprite" mode when the first sprite appears.
    const blue = { r: 0, g: 0, b: 1, a: 1 };
    registerSpriteRenderer(
      createSpriteRenderer(running.renderer.engine, { layers: [], clear: true, clearValue: blue }),
    );
    await running.advance(SETTLE_FRAMES);

    const contexts = getRenderingContexts(running.renderer.engine);
    expect(contexts.at(-1)).toBe(overlay.lite.scene);
    expectDominant(await running.centrePixel(), "g");
    const corner = await running.pixelAt(CORNER.x, CORNER.y);
    expect(corner.b, "the sprite renderer cleared the frame").toBeGreaterThan(200);
    expectNoDeviceErrors();
  }, 60_000);

  it("stops drawing once disposed, and the scene keeps rendering", async () => {
    const running = await startScene({ msaa: 4, path: "plain" });
    const overlay = await running.app.renderer.openOverlay();
    addGreenBox(running, overlay);
    await running.advance(SETTLE_FRAMES);
    expectDominant(await running.centrePixel(), "g");

    overlay.dispose();
    overlay.dispose();
    await running.advance(SETTLE_FRAMES);

    expectDominant(await running.centrePixel(), "r");
    expectGrey(await running.pixelAt(CORNER.x, CORNER.y));
    expect(getRenderingContexts(running.renderer.engine)).not.toContain(overlay.lite.scene);
    expectNoDeviceErrors();
  }, 60_000);

  it("is refused with IGX-0728 before app.start() registers the render scene", async () => {
    const running = await createBrowserApp({ size: SIZE, startEmpty: false });
    harness = running;
    await expect(running.app.renderer.openOverlay()).rejects.toMatchObject({ code: "IGX-0728" });
  }, 60_000);

  it("is disposed with the app", async () => {
    const running = await startScene({ msaa: 1, path: "plain" });
    const overlay = await running.app.renderer.openOverlay();
    addGreenBox(running, overlay);
    await running.advance(2);
    expect(overlay.lite.scene.meshes.length).toBe(1);
    running.dispose();
    harness = null;
    // `disposeScene` clears both; disposing the engine alone does not.
    expect(overlay.lite.scene.meshes.length).toBe(0);
    expect(overlay.lite.scene.camera).toBeNull();
  }, 60_000);

  // How long after `openOverlay()` the app is disposed: before the module loads, while the scene
  // registers, or later. Whichever it is, nothing may stay registered on the disposed engine.
  for (const ticks of [0, 1, 2, 4, 8, 16, 32]) {
    it(`leaves nothing behind when the app is disposed ${String(ticks)} microtasks into openOverlay()`, async () => {
      await disposeWhileOpening(ticks);
    }, 60_000);
  }
});
