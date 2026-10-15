import { afterEach, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import {
  createMaterialAsset,
  pbrMaterialDefinition,
  standardMaterialDefinition,
} from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createBrowserApp, gpuDeviceErrors, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * A renderable rebuild that spans several frames, in a scene with two material families
 * (`src/lite/shadow.ts`, `holdGpuRetirements`).
 *
 * Lite rebuilds one material group at a time and retires each group's old buffers as soon as that
 * group is done, but the frames keep drawing the old renderables until the last group has been
 * rebuilt. On a slow machine the second group's build outlasts the first group's retirement fence,
 * and the next frame submits a destroyed buffer (`late-first-pbr-build-shadow.browser.test.ts`
 * failed that way on CI). This test makes the second group slow on purpose: it holds Lite's
 * per-scene build queue shut for a few frames right after the first group has built.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The Lite fields the test reaches into. Absent from `index.d.ts`. */
interface RebuildInternals {
  /** The scene's disposer list; a group builder pushes its cache reset here as it finishes. */
  _disposables: (() => void)[];
  /** Lite's runtime-build queue; every group of a rebuild waits its turn through `exclusive`. */
  _runtimeBuilds?: { exclusive(builder: object, work: () => Promise<void>): Promise<void> };
}

/** A placeholder until a promise hands over its resolver. */
function doNothing(): void {
  // Replaced before it is called.
}

/**
 * Stalls the next renderable rebuild between its first and its second material group.
 *
 * @param scene - The scene's Lite internals.
 * @returns Whether the stall has started, and a function that lets the rebuild go on.
 */
function stallAfterFirstGroup(scene: RebuildInternals): { isStalled(): boolean; release(): void } {
  // oxlint-disable-next-line no-underscore-dangle
  const list = scene._disposables;
  const push = list.push;
  let release = doNothing;
  let isStalled = false;
  // `trackMaterialCacheResets` already gave the list an own `push`; wrap whatever is there.
  Object.defineProperty(list, "push", {
    configurable: true,
    writable: true,
    value: (...items: (() => void)[]): number => {
      if (!isStalled) {
        // The first group's builder is finishing: queue a slow "build" behind it, so the next group waits.
        isStalled = true;
        // oxlint-disable-next-line no-underscore-dangle
        void scene._runtimeBuilds?.exclusive(
          {},
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        );
      }
      return push.apply(list, items);
    },
  });
  return { isStalled: (): boolean => isStalled, release: (): void => release() };
}

it("keeps every buffer a frame draws alive while a two-family rebuild spans several frames", async () => {
  const device = gpuDeviceErrors();
  const running = await createBrowserApp({
    size: 64,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows: true } } },
  });
  harness = running;
  device.stop();
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 9, -0.01);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });
  const standard = createMaterialAsset(running.app, standardMaterialDefinition(), []);
  const pbr = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const ground = running.world.createEntity("Ground").addComponent(MeshRenderer, {
    mesh: MeshAsset.ground(running.app, { width: 30, height: 30, subdivisions: 1 }),
    materials: [standard],
    castShadows: false,
  });
  const box = running.world.createEntity("Box");
  box.transform.localPosition.set(0, 1.5, 0);
  box.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 1 }), materials: [standard] });
  await running.start();
  await running.advance(SETTLE_FRAMES);
  const addLight = (name: string, x: number): void => {
    const entity = running.world.createEntity(name);
    entity.transform.localPosition.set(x, 8, 0.001);
    entity.transform.lookAt({ x: 0, y: 0, z: 0 });
    entity.addComponent(Light, { type: "directional", intensity: 0.6, shadows: { enabled: true, mapSize: 512 } });
  };
  addLight("Left", -6);
  await running.advance(SETTLE_FRAMES);
  // The Standard group was built at start; the PBR group is built now, after it.
  ground.materials = [pbr];
  await running.advance(SETTLE_FRAMES * 4);
  expect(device.errors).toEqual([]);

  // Boundary assertion: the scene is a Lite 1.34.0 scene, which carries both fields.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const stall = stallAfterFirstGroup(running.renderer.scene as unknown as RebuildInternals);
  // A second light is a topology change, so the render sync system rebuilds every group.
  addLight("Right", 6);
  await running.advance(SETTLE_FRAMES * 2);
  expect(stall.isStalled()).toBe(true);
  stall.release();
  await running.advance(SETTLE_FRAMES * 2);

  expect(device.errors).toEqual([]);
  expect(running.errors).toEqual([]);
}, 60_000);
