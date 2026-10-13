import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../../src/render/camera.js";
import { Light } from "../../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../../src/render/material-asset.js";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import { customEffect } from "../../../src/render/post-effect.js";
import { PostProcessStack } from "../../../src/render/post-process-stack.js";
import { createSurfaceBrowserApp, SURFACE_SETTLE_FRAMES } from "../../fixtures/shaders/surface-browser.js";
import { PASS_THROUGH_POST_WGSL } from "../../fixtures/shaders/surfaces.js";
import type { PixelRgba } from "../../../src/lite/screenshot.js";
import type { SurfaceBrowserApp } from "../../fixtures/shaders/surface-browser.js";

/**
 * A post-process chain presents the frame the right way up, whatever its length
 * (`docs/architecture/07-rendering.md` §2.7).
 *
 * A bright box sits in the top-left of a black frame, and the chain is made of pass-through custom
 * effects, so the only thing a chain could change is where the box lands. Before 0.5.1 every custom
 * effect flipped the frame vertically, so a chain with an odd number of them showed the box in the
 * bottom-left.
 */

let harness: SurfaceBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge. */
const SIZE = 48;

/** A pixel inside the box (top-left quarter) and its mirror images in the other quarters. */
const TOP_LEFT = { x: 12, y: 12 } as const;
const BOTTOM_LEFT = { x: 12, y: 36 } as const;
const TOP_RIGHT = { x: 36, y: 12 } as const;

/** The scene one test drives. */
interface Scene {
  /** The running app. */
  readonly running: SurfaceBrowserApp;
  /** The stack the effects are pushed onto. */
  readonly stack: PostProcessStack;
}

/**
 * Builds a small white box in the top-left of a black frame, with a `PostProcessStack` on the camera.
 *
 * @returns The scene.
 */
async function buildScene(): Promise<Scene> {
  const running = await createSurfaceBrowserApp({
    size: SIZE,
    start: false,
    settings: {
      rendering: { msaaSamples: 1, clearColor: { r: 0, g: 0, b: 0, a: 1 }, features: { postProcessing: true } },
    },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -2.2);
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });
  const stack = eye.addComponent(PostProcessStack);

  running.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });
  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ name: "white", baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const box = running.world.createEntity("Marker");
  // The camera looks down +z, so -x is screen left and +y is screen up.
  box.transform.localPosition.set(-0.65, 0.65, 0);
  box.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 0.9 }), materials: [white] });

  await running.start();
  await running.advance(SURFACE_SETTLE_FRAMES);
  return { running, stack };
}

/**
 * Reads the three probe pixels.
 *
 * @param running - The running app.
 * @returns The top-left, bottom-left and top-right pixels.
 */
async function probes(running: SurfaceBrowserApp): Promise<readonly [PixelRgba, PixelRgba, PixelRgba]> {
  return [
    await running.pixelAt(TOP_LEFT.x, TOP_LEFT.y),
    await running.pixelAt(BOTTOM_LEFT.x, BOTTOM_LEFT.y),
    await running.pixelAt(TOP_RIGHT.x, TOP_RIGHT.y),
  ];
}

/**
 * Asserts the box is in the top-left only.
 *
 * @param running - The running app.
 * @param label - What the chain is, for the failure message.
 */
async function expectBoxTopLeft(running: SurfaceBrowserApp, label: string): Promise<void> {
  const [topLeft, bottomLeft, topRight] = await probes(running);
  const read = `${label}: top-left ${String(topLeft.r)}, bottom-left ${String(bottomLeft.r)}, top-right ${String(topRight.r)}`;
  expect(topLeft.r, read).toBeGreaterThan(60);
  expect(bottomLeft.r, read).toBeLessThan(20);
  expect(topRight.r, read).toBeLessThan(20);
}

describe("a post-process chain's orientation", () => {
  it("draws the box in the top-left without a chain", async () => {
    const scene = await buildScene();
    await expectBoxTopLeft(scene.running, "no chain");
  }, 60_000);

  it("keeps it there through a one-pass chain (SMAA alone)", async () => {
    const scene = await buildScene();
    scene.stack.smaa.enabled = true;
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    expect(scene.stack.taskCount).toBe(1);
    await expectBoxTopLeft(scene.running, "1 pass");
    expect(scene.running.errors).toStrictEqual([]);
  }, 60_000);

  // The seed copy plus one to four pass-through effects: chains of two to five passes.
  for (const effects of [1, 2, 3, 4]) {
    it(`keeps it there through a ${String(effects + 1)}-pass chain (${String(effects)} custom)`, async () => {
      const scene = await buildScene();
      const shader = scene.running.publishShader("shaders/pass-through.post.wgsl", PASS_THROUGH_POST_WGSL);
      for (let index = 0; index < effects; index += 1) {
        scene.stack.custom.push(customEffect({ shader, order: index }));
      }
      await scene.running.advance(SURFACE_SETTLE_FRAMES);
      expect(scene.stack.taskCount).toBe(effects + 1);
      await expectBoxTopLeft(scene.running, `${String(effects + 1)} passes`);
      expect(scene.running.errors).toStrictEqual([]);
    }, 60_000);
  }

  it("keeps it there when a built-in seeds the custom effects", async () => {
    const scene = await buildScene();
    const shader = scene.running.publishShader("shaders/pass-through.post.wgsl", PASS_THROUGH_POST_WGSL);
    scene.stack.smaa.enabled = true;
    scene.stack.custom.push(customEffect({ shader, order: 5 }), customEffect({ shader, order: 6 }));
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    expect(scene.stack.taskCount).toBe(3);
    await expectBoxTopLeft(scene.running, "SMAA + 2 custom");
  }, 60_000);
});
