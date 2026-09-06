import { afterEach, describe, expect, it } from "vitest";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import {
  addCameraAndLight,
  createBrowserApp,
  pixelLuminance,
  pixelsDiffer,
  SETTLE_FRAMES,
} from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { PixelRgba } from "../../src/lite/screenshot.js";

/**
 * `PostProcessStack` on a real device (`docs/architecture/07-rendering.md` §2.7).
 *
 * The Phase 2 visual suite found that every non-empty chain presented a **black** frame: the first
 * effect sampled the swapchain, which a WebGPU canvas context is not configured to allow, and the
 * frame's whole command buffer was rejected. The old version of this suite passed anyway, because it
 * only asserted that the image *changed* — and black is a change. So every assertion here is about
 * brightness or about a direction the image is supposed to move in, never about mere difference.
 *
 * The chain now reads the offscreen colour the scene was rendered into
 * (`src/lite/gpu/render-path.ts`), which is what `rendering.features.postProcessing` buys.
 */

/** The canvas edge every scene here uses. Small keeps SwiftShader fast. */
const SIZE = 48;

/** How dark a pixel has to be to count as "the frame was rejected". */
const BLACK = 8;

/** How far back the camera sits, in metres. The cube is two metres across. */
const CAMERA_DISTANCE = 8;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a lit scene with a bright white box on black, ready for an effect chain.
 *
 * @param options - Scene options.
 * @param options.postProcessing - Whether the `postProcessing` rendering feature is declared.
 * @param options.msaaSamples - The MSAA sample count the surface is created with.
 * @param options.beforeStart - Runs after the world is built and before `app.start()`.
 * @returns The running app.
 */
async function buildScene(
  options: {
    readonly postProcessing?: boolean;
    readonly msaaSamples?: number;
    readonly beforeStart?: (running: BrowserApp) => void;
  } = {},
): Promise<BrowserApp> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: {
      rendering: {
        msaaSamples: options.msaaSamples ?? 1,
        features: { postProcessing: options.postProcessing !== false },
      },
    },
  });
  harness = running;
  // Far enough back that the cube sits in the middle of a black background: the corner samples have
  // to be background for "bloom bled onto it" to mean anything.
  const camera = addCameraAndLight(running, CAMERA_DISTANCE);
  // Lite's own scene clear colour is a mid grey, and `rendering.clearColor` is not wired to it; the
  // camera override is. Black makes "the frame is not black" and "bloom bled onto the background"
  // two different measurements instead of one.
  camera.clearColor = { r: 0, g: 0, b: 0, a: 1 };
  const mesh = MeshAsset.box(running.app, { size: 2 });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world.createEntity("Cube").addComponent(MeshRenderer, { mesh, materials: [material] });
  options.beforeStart?.(running);
  await running.start();
  await running.advance(SETTLE_FRAMES * 2);
  return running;
}

/**
 * The four pixels a chain is judged by: the centre and three corners.
 *
 * @param running - The running app.
 * @returns The samples.
 */
async function samples(running: BrowserApp): Promise<readonly PixelRgba[]> {
  const edge = running.canvas.width - 2;
  const centre = running.canvas.width >> 1;
  return [
    await running.pixelAt(centre, centre),
    await running.pixelAt(2, 2),
    await running.pixelAt(edge, 2),
    await running.pixelAt(edge, edge),
  ];
}

/**
 * The luminance of the centre pixel, which sits on the lit cube.
 *
 * @param running - The running app.
 * @returns The luminance, 0 to 255.
 */
async function centreLuminance(running: BrowserApp): Promise<number> {
  return pixelLuminance(await running.centrePixel());
}

/**
 * The luminance of a background corner, where a bloom bleed shows up.
 *
 * @param running - The running app.
 * @returns The luminance, 0 to 255.
 */
async function cornerLuminance(running: BrowserApp): Promise<number> {
  return pixelLuminance(await running.pixelAt(2, 2));
}

/**
 * Whether two sample sets agree everywhere within a tolerance.
 *
 * @param before - The first set.
 * @param after - The second set.
 * @param tolerance - The largest per-channel difference that still counts as equal.
 * @returns `true` when every sample matches.
 */
function allMatch(before: readonly PixelRgba[], after: readonly PixelRgba[], tolerance: number): boolean {
  for (let index = 0; index < before.length; index += 1) {
    const first = before[index];
    const second = after[index];
    if (first !== undefined && second !== undefined && pixelsDiffer(first, second, tolerance)) {
      return false;
    }
  }
  return true;
}

describe("the postProcessing rendering feature", () => {
  it("presents the scene through the offscreen path with no stack at all", async () => {
    const running = await buildScene();
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
    expect(running.errors).toEqual([]);
  });

  it("presents the same image whether or not the feature is on", async () => {
    const withFeature = await buildScene({ postProcessing: true });
    const offscreen = await samples(withFeature);
    withFeature.dispose();
    harness = null;

    const plain = await buildScene({ postProcessing: false });
    // The offscreen path is a different frame graph reaching the same pixels, within a rounding of
    // the extra copy.
    expect(allMatch(offscreen, await samples(plain), 4)).toBe(true);
  });

  it("logs IGX-0710 once and stays inert when the feature is off", async () => {
    const running = await buildScene({ postProcessing: false });
    const before = await samples(running);

    const stack = running.world.createEntity("Post").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.smaa.enabled = true;
    await running.advance(SETTLE_FRAMES * 3);

    expect(stack.taskCount).toBe(0);
    expect(allMatch(before, await samples(running), 4)).toBe(true);
    const warnings = running.log.toArray().filter((record) => record.message.includes("IGX-0710"));
    expect(warnings).toHaveLength(1);
  });
});

describe("an effect chain", () => {
  it("records bloom, SMAA, and image processing, and presents a frame that is not black", async () => {
    const running = await buildScene();
    const plainCentre = await centreLuminance(running);
    expect(plainCentre).toBeGreaterThan(BLACK * 4);

    const stack = running.world.createEntity("Post").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.smaa.enabled = true;
    stack.imageProcessing.enabled = true;
    expect(stack.plannedChain()).toEqual(["bloom", "smaa", "imageProcessing"]);

    await running.advance(SETTLE_FRAMES * 3);
    expect(stack.taskCount).toBe(3);
    // The claim the old suite could not make: the cube is still there.
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
    expect(running.errors).toEqual([]);
  });

  it("brightens the frame when the image-processing pass is given more exposure", async () => {
    const running = await buildScene();
    const stack = running.world.createEntity("Post").addComponent(PostProcessStack);
    stack.imageProcessing.enabled = true;
    await running.advance(SETTLE_FRAMES * 3);
    expect(stack.taskCount).toBe(1);

    const scene = running.app.lite.scene;
    scene.imageProcessing.exposure = 1;
    await running.advance(SETTLE_FRAMES * 2);
    const dim = await centreLuminance(running);

    scene.imageProcessing.exposure = 2;
    await running.advance(SETTLE_FRAMES * 2);
    const bright = await centreLuminance(running);

    expect(dim).toBeGreaterThan(BLACK);
    expect(bright).toBeGreaterThan(dim);
    expect(running.errors).toEqual([]);
  });

  it("bleeds a bright object onto the background when bloom runs", async () => {
    const running = await buildScene();
    const dark = await cornerLuminance(running);
    expect(dark).toBeLessThan(BLACK);

    const stack = running.world.createEntity("Post").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.bloom.threshold = 0.2;
    stack.bloom.weight = 1;
    stack.bloom.kernel = 64;
    stack.bloom.scale = 1;
    await running.advance(SETTLE_FRAMES * 3);

    expect(await cornerLuminance(running)).toBeGreaterThan(dark);
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
    expect(running.errors).toEqual([]);
  });

  it("presents the plain scene while every effect is off", async () => {
    const running = await buildScene();
    const plain = await samples(running);

    const stack = running.world.createEntity("Post").addComponent(PostProcessStack);
    await running.advance(SETTLE_FRAMES * 2);

    expect(stack.plannedChain()).toEqual([]);
    expect(stack.taskCount).toBe(0);
    expect(allMatch(plain, await samples(running), 2)).toBe(true);
  });

  it("goes back to the plain scene when the component is disabled, and comes back", async () => {
    const running = await buildScene();
    const plain = await samples(running);

    const stack = running.world.createEntity("Post").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.bloom.threshold = 0.2;
    stack.bloom.weight = 1;
    stack.bloom.kernel = 64;
    stack.bloom.scale = 1;
    await running.advance(SETTLE_FRAMES * 3);
    const withEffect = await samples(running);
    expect(allMatch(plain, withEffect, 2)).toBe(false);

    stack.enabled = false;
    await running.advance(SETTLE_FRAMES * 3);
    // The compositing blit takes over, so the swapchain still gets a frame — not a stale one, and
    // certainly not a black one.
    expect(allMatch(plain, await samples(running), 4)).toBe(true);

    stack.enabled = true;
    await running.advance(SETTLE_FRAMES * 3);
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
    expect(running.errors).toEqual([]);
  });

  it("disposes its tasks when the component is destroyed, and keeps presenting", async () => {
    const running = await buildScene();
    const stack = running.world.createEntity("Post").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    await running.advance(SETTLE_FRAMES * 3);
    expect(stack.taskCount).toBeGreaterThan(0);

    stack.destroy();
    await running.advance(SETTLE_FRAMES * 3);
    expect(stack.taskCount).toBe(0);
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
    expect(running.errors).toEqual([]);
  });
});

describe("an effect chain on a multisampled surface", () => {
  it("reads the resolved single-sample colour and still presents", async () => {
    const running = await buildScene({ msaaSamples: 4 });
    const stack = running.world.createEntity("Post").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.smaa.enabled = true;
    await running.advance(SETTLE_FRAMES * 3);

    expect(stack.taskCount).toBe(2);
    // SMAA refuses a multisampled source (Lite error 108), so this only works because the scene task
    // resolves into the single-sample target through `rst`.
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
    expect(running.errors).toEqual([]);
  });
});

describe("resizing the canvas under a chain", () => {
  it("keeps presenting at the new size", async () => {
    const running = await buildScene();
    const stack = running.world.createEntity("Post").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.smaa.enabled = true;
    await running.advance(SETTLE_FRAMES * 3);
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);

    // A laid-out DOM canvas is resized by its CSS box: Lite's loop calls `resizeEngine` every frame
    // and snaps the backing store to `clientWidth × clientHeight × devicePixelRatio`, which asks the
    // scene to rebuild its frame graph — and with it every target sized by the surface.
    const grown = SIZE * 2;
    running.canvas.style.width = `${String(grown)}px`;
    running.canvas.style.height = `${String(grown)}px`;
    await running.advance(SETTLE_FRAMES * 4);

    expect(running.canvas.width).toBeGreaterThan(SIZE);
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
    expect(running.errors).toEqual([]);
  });
});

describe("a stack configured before app.start()", () => {
  /**
   * Before `start()` the scene's frame graph has never been built, so the offscreen scene colour
   * owns no GPU texture yet. Recording an effect against it there raised Lite error 107 —
   * `PostProcessTask "ignifx:bloom-extract-highlights": sourceTexture has no color texture` — and
   * WebGPU rejected the frame, which is a black page. The chain now appends its tasks and lets
   * `registerScene`'s own `frameGraph.build()` record them, in array order, after the scene task.
   */

  /**
   * Builds the scene with a `PostProcessStack` attached and tuned before `app.start()`.
   *
   * @param options - Scene options.
   * @param options.postProcessing - Whether the `postProcessing` rendering feature is declared.
   * @param options.tune - Configures the stack, before the app starts.
   * @returns The running app and the stack it carries. The stack is held in a box rather than a
   * `let`, because a value assigned only inside a callback narrows to `never` afterwards.
   */
  async function buildSceneWithStack(options: {
    readonly postProcessing?: boolean;
    readonly tune: (stack: PostProcessStack) => void;
  }): Promise<{ readonly running: BrowserApp; readonly stack: PostProcessStack }> {
    const box: { stack: PostProcessStack | null } = { stack: null };
    const running = await buildScene({
      ...(options.postProcessing === undefined ? {} : { postProcessing: options.postProcessing }),
      beforeStart: (app) => {
        const stack = app.world.createEntity("Post").addComponent(PostProcessStack);
        options.tune(stack);
        box.stack = stack;
      },
    });
    const { stack } = box;
    if (stack === null) {
      throw new Error("the stack was never built");
    }
    return { running, stack };
  }

  it("records bloom and presents a lit frame, with no error", async () => {
    const { running, stack } = await buildSceneWithStack({
      tune: (post) => {
        post.bloom.enabled = true;
        post.bloom.threshold = 0.2;
        post.bloom.weight = 1;
        post.bloom.kernel = 64;
        post.bloom.scale = 1;
      },
    });

    expect(stack.taskCount).toBe(1);
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
    expect(await cornerLuminance(running)).toBeGreaterThan(0);
    expect(running.errors).toEqual([]);
    expect(running.log.toArray().filter((record) => record.level === "error")).toEqual([]);
  });

  it("records a bloom + SMAA chain in order and still presents", async () => {
    const { running, stack } = await buildSceneWithStack({
      tune: (post) => {
        post.bloom.enabled = true;
        post.smaa.enabled = true;
      },
    });

    expect(stack.plannedChain()).toEqual(["bloom", "smaa"]);
    expect(stack.taskCount).toBe(2);
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
    expect(running.errors).toEqual([]);
  });

  it("still logs IGX-0710 once when the feature was never declared", async () => {
    const { running, stack } = await buildSceneWithStack({
      postProcessing: false,
      tune: (post) => {
        post.bloom.enabled = true;
      },
    });
    await running.advance(SETTLE_FRAMES * 2);

    expect(stack.taskCount).toBe(0);
    expect(running.log.toArray().filter((record) => record.message.includes("IGX-0710"))).toHaveLength(1);
    expect(await centreLuminance(running)).toBeGreaterThan(BLACK * 4);
  });
});
