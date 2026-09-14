import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../../src/render/camera.js";
import { Light } from "../../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../../src/render/material-asset.js";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import { customEffect } from "../../../src/render/post-effect.js";
import { PostProcessStack } from "../../../src/render/post-process-stack.js";
import { createSurfaceBrowserApp, SURFACE_SETTLE_FRAMES } from "../../fixtures/shaders/surface-browser.js";
import { INVERT_POST_WGSL, SCANLINE_POST_WGSL, TINT_POST_WGSL } from "../../fixtures/shaders/surfaces.js";
import type { SurfaceBrowserApp } from "../../fixtures/shaders/surface-browser.js";

/**
 * Custom `// @ignifx post` effects recorded into a real frame graph
 * (`docs/architecture/07-rendering.md` §2.7).
 *
 * The chain is what is under test rather than any one shader: a custom effect samples a `Texture2D`
 * and Lite's built-in passes write a `RenderTarget`, so the links have to be both, the first custom
 * effect needs a copy to seed it, and the last one has to land on the swapchain. Every one of those
 * fails as a black frame rather than an exception, which is why these assertions are on pixels.
 */

let harness: SurfaceBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge every scene here uses. */
const SIZE = 48;

/** The scene one test drives. */
interface Scene {
  /** The running app. */
  readonly running: SurfaceBrowserApp;
  /** The stack the effects are pushed onto. */
  readonly stack: PostProcessStack;
}

/**
 * Builds a white lit box filling most of the frame, with a `PostProcessStack` on the camera.
 *
 * @returns The scene.
 */
async function buildScene(): Promise<Scene> {
  const running = await createSurfaceBrowserApp({
    size: SIZE,
    start: false,
    settings: { rendering: { msaaSamples: 1, features: { postProcessing: true } } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -2.2);
  const camera = eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });
  const stack = eye.addComponent(PostProcessStack);

  const sun = running.world.createEntity("Sun");
  sun.addComponent(Light, { type: "hemispheric", intensity: 1 });

  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ name: "white", baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const box = MeshAsset.box(running.app, { size: 3 });
  running.world.createEntity("Wall").addComponent(MeshRenderer, { mesh: box, materials: [white] });

  await running.start();
  await running.advance(SURFACE_SETTLE_FRAMES);
  expect(camera.isEnabledInHierarchy).toBe(true);
  return { running, stack };
}

describe("one custom effect", () => {
  it("tints the frame green and lands it on the swapchain", async () => {
    const scene = await buildScene();
    const before = await scene.running.centrePixel();
    expect(before.r).toBeGreaterThan(60);

    const shader = scene.running.publishShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    scene.stack.custom.push(customEffect({ shader }));
    await scene.running.advance(SURFACE_SETTLE_FRAMES);

    const after = await scene.running.centrePixel();
    expect(after.g).toBeGreaterThan(after.r + 30);
    expect(scene.running.errors).toStrictEqual([]);
  });

  it("records two tasks: the copy that seeds it, and the effect", async () => {
    const scene = await buildScene();
    const shader = scene.running.publishShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    scene.stack.custom.push(customEffect({ shader }));
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    // A custom effect samples a `Texture2D` and the offscreen scene colour is a plain
    // `RenderTarget`, so a chain whose *first* effect is a custom one pays for one copy into a
    // sampled link (`src/lite/gpu/effect-task.ts`). A chain that starts with bloom or SMAA does not.
    expect(scene.stack.taskCount).toBe(2);
  });

  it("re-uploads its uniform buffer when a value changes, with no rebuild", async () => {
    const scene = await buildScene();
    const shader = scene.running.publishShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    const effect = customEffect({ shader, values: { amount: 1 } });
    scene.stack.custom.push(effect);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const tinted = await scene.running.centrePixel();

    effect.values["amount"] = 0;
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const plain = await scene.running.centrePixel();

    expect(plain.r).toBeGreaterThan(tinted.r + 30);
    // Still the seed copy plus the one effect: a value change re-uploads and never rebuilds.
    expect(scene.stack.taskCount).toBe(2);
  });

  it("reads the built-in screenSize and time without declaring them", async () => {
    const scene = await buildScene();
    const shader = scene.running.publishShader("shaders/scanline.post.wgsl", SCANLINE_POST_WGSL);
    scene.stack.custom.push(customEffect({ shader }));
    // Alternating rows are halved, so two neighbouring rows differ once the effect is drawing. The
    // pipeline compiles asynchronously, so poll instead of trusting a fixed frame count on a slow adapter.
    let difference = 0;
    for (let round = 0; round < 6 && difference <= 10; round += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each round depends on the frames before it.
      await scene.running.advance(SURFACE_SETTLE_FRAMES);
      // oxlint-disable-next-line eslint/no-await-in-loop -- reads the frame the round just produced.
      const even = await scene.running.pixelAt(SIZE >> 1, 20);
      // oxlint-disable-next-line eslint/no-await-in-loop -- reads the frame the round just produced.
      const odd = await scene.running.pixelAt(SIZE >> 1, 21);
      difference = Math.abs(even.r - odd.r);
    }
    expect(difference).toBeGreaterThan(10);
    expect(scene.running.errors).toStrictEqual([]);
  });
});

describe("two custom effects", () => {
  it("runs them in order, so the second sees the first's output", async () => {
    const scene = await buildScene();
    const tint = scene.running.publishShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    const invert = scene.running.publishShader("shaders/invert.post.wgsl", INVERT_POST_WGSL);
    scene.stack.custom.push(customEffect({ shader: tint, order: 1 }), customEffect({ shader: invert, order: 2 }));
    await scene.running.advance(SURFACE_SETTLE_FRAMES);

    const pixel = await scene.running.centrePixel();
    // Green tint, then inverted: green is the brightest channel before the inversion and therefore
    // the darkest after it.
    expect(pixel.g).toBeLessThan(pixel.r);
    expect(scene.stack.taskCount).toBeGreaterThanOrEqual(2);
    expect(scene.running.errors).toStrictEqual([]);
  });

  it("puts the inverted one first when its order says so", async () => {
    const scene = await buildScene();
    const tint = scene.running.publishShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    const invert = scene.running.publishShader("shaders/invert.post.wgsl", INVERT_POST_WGSL);
    scene.stack.custom.push(customEffect({ shader: tint, order: 2 }), customEffect({ shader: invert, order: 1 }));
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    // Inverted first, then tinted: the green channel survives the tint, so it stays the brightest.
    const pixel = await scene.running.centrePixel();
    expect(pixel.g).toBeGreaterThanOrEqual(pixel.r);
  });
});

describe("mixing with the built-ins", () => {
  it("keeps image processing last, whatever the custom effect's order says", async () => {
    const scene = await buildScene();
    const shader = scene.running.publishShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    scene.stack.imageProcessing.enabled = true;
    scene.stack.custom.push(customEffect({ shader, order: 99 }));
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    expect(scene.stack.plannedChain()).toStrictEqual(["imageProcessing", "custom"]);
    // The recorded chain reorders it, and the frame still arrives: the seed copy, the effect, and
    // the grading pass.
    expect(scene.stack.taskCount).toBe(3);
    expect(scene.running.errors).toStrictEqual([]);
  });

  it("runs after bloom, which writes a link the effect can sample", async () => {
    const scene = await buildScene();
    const shader = scene.running.publishShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    scene.stack.bloom.enabled = true;
    scene.stack.custom.push(customEffect({ shader, order: 5 }));
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const pixel = await scene.running.centrePixel();
    expect(pixel.g).toBeGreaterThan(pixel.r + 20);
    expect(scene.running.errors).toStrictEqual([]);
  });
});

describe("switching a custom effect off", () => {
  it("drops its task and presents the plain scene again", async () => {
    const scene = await buildScene();
    const shader = scene.running.publishShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    const effect = customEffect({ shader });
    scene.stack.custom.push(effect);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    expect(scene.stack.taskCount).toBe(2);

    effect.enabled = false;
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    expect(scene.stack.taskCount).toBe(0);
    const restored = await scene.running.centrePixel();
    expect(restored.r).toBeGreaterThan(60);
    expect(Math.abs(restored.r - restored.g)).toBeLessThan(12);
  });

  it("removing it from the list drops it too", async () => {
    const scene = await buildScene();
    const shader = scene.running.publishShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    scene.stack.custom.push(customEffect({ shader }));
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    scene.stack.custom.length = 0;
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    expect(scene.stack.taskCount).toBe(0);
  });
});
