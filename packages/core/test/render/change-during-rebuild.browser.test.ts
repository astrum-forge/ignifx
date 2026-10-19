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
 * Scene changes that land while a renderable rebuild is in flight (`src/lite/shadow.ts`,
 * `rebuildAcrossMaterialSwaps`; `src/render/light.ts`, `#applyShadows`).
 *
 * On a loaded machine a rebuild spans frames, and the frames go on changing the scene. Both cases
 * here made `late-first-pbr-build-shadow.browser.test.ts` fail on CI runners: a ground switched to
 * PBR while the Standard group was being rebuilt, and a shadow switched on between two groups.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The Lite fields the tests reach into. Absent from `index.d.ts`. */
interface RebuildInternals {
  /** Set by `rebuildSceneGroups` after it has chosen a group's meshes and before it builds them. */
  _p?: unknown;
  /** The scene's disposer list; a group builder pushes its cache reset here as it finishes. */
  _disposables: (() => void)[];
  /** Lite's runtime-build queue; every group of a rebuild waits its turn through `exclusive`. */
  _runtimeBuilds?: { exclusive(builder: object, work: () => Promise<void>): Promise<void> };
}

/** A Lite mesh, as far as these tests touch it. */
interface LiteMeshMaterial {
  /** The material it draws with; writing it queues a material swap. */
  material: unknown;
}

/**
 * Runs `change` once, the next time a rebuild has chosen a group's meshes but not yet built them.
 *
 * @param scene - The scene's Lite internals.
 * @param change - What to do in that window.
 * @returns Whether the change has run.
 */
function onNextGroupBuild(scene: RebuildInternals, change: () => void): () => boolean {
  let hasRun = false;
  // `rebuildSceneGroups` assigns `_p` and later deletes it, which removes this accessor with it.
  Object.defineProperty(scene, "_p", {
    configurable: true,
    enumerable: true,
    get: (): undefined => undefined,
    set: (value: unknown): void => {
      Object.defineProperty(scene, "_p", { configurable: true, enumerable: true, writable: true, value });
      if (!hasRun) {
        hasRun = true;
        change();
      }
    },
  });
  return (): boolean => hasRun;
}

/**
 * Waits for real frames until a condition holds. A rebuild takes as many frames as the machine
 * makes it take, so the tests wait on what they need rather than on a frame count; the test's
 * timeout bounds a condition that never holds.
 *
 * @param running - The harness.
 * @param done - The condition, read before each frame.
 * @returns A promise that settles once `done` holds.
 */
async function framesUntil(running: BrowserApp, done: () => boolean): Promise<void> {
  if (done()) {
    return;
  }
  await running.nextFrame();
  return framesUntil(running, done);
}

/** A placeholder until a promise hands over its resolver. */
function doNothing(): void {
  // Replaced before it is called.
}

/**
 * Stalls the next renderable rebuild between its first and its second material group, as
 * `slow-rebuild.browser.test.ts` does.
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
  Object.defineProperty(list, "push", {
    configurable: true,
    writable: true,
    value: (...items: (() => void)[]): number => {
      if (!isStalled) {
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

/**
 * Builds the shared scene: a camera looking down at a ground and a box, both Standard.
 *
 * @returns The harness, the ground's renderer, and a PBR material to switch it to.
 */
async function buildScene(): Promise<{
  running: BrowserApp;
  ground: MeshRenderer;
  pbr: ReturnType<typeof createMaterialAsset>;
  addLight: (name: string, x: number, casts: boolean) => Light;
}> {
  const running = await createBrowserApp({
    size: 64,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows: true } } },
  });
  harness = running;
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
  const addLight = (name: string, x: number, casts: boolean): Light => {
    const entity = running.world.createEntity(name);
    entity.transform.localPosition.set(x, 8, 0.001);
    entity.transform.lookAt({ x: 0, y: 0, z: 0 });
    return entity.addComponent(Light, {
      type: "directional",
      intensity: 0.6,
      shadows: { enabled: casts, mapSize: 512 },
    });
  };
  await running.start();
  await running.advance(SETTLE_FRAMES);
  addLight("Left", -6, true);
  await running.advance(SETTLE_FRAMES);
  return { running, ground, pbr, addLight };
}

it("finishes a rebuild that a material swap to another family landed in", async () => {
  const device = gpuDeviceErrors();
  const { running, ground, pbr, addLight } = await buildScene();
  device.stop();
  const liteGround = ground.lite.mesh as unknown as LiteMeshMaterial | null;
  const pbrMaterial = pbr.value.lite.material;
  expect(liteGround).not.toBeNull();

  // Boundary assertion: the scene is a Lite 1.34.0 scene.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const scene = running.renderer.scene as unknown as RebuildInternals;
  // The Standard group has chosen its meshes, ground included, and awaits its shader modules when
  // the ground turns PBR — what a frame does when that await outlasts it.
  const hasSwapped = onNextGroupBuild(scene, () => {
    if (liteGround !== null) {
      liteGround.material = pbrMaterial;
    }
    ground.materials = [pbr];
  });
  // A second light is a topology change, so the render sync system rebuilds every group.
  addLight("Right", 6, false);
  await framesUntil(running, () => hasSwapped() && !running.renderer.isRebuildInFlight);
  await running.advance(SETTLE_FRAMES);

  expect(running.errors).toEqual([]);
  expect(device.errors).toEqual([]);
}, 60_000);

it("switches a shadow on only once the rebuild in flight has finished", async () => {
  const device = gpuDeviceErrors();
  const { running, ground, pbr, addLight } = await buildScene();
  device.stop();
  // Two families, so a rebuild has a gap between groups for a generator to land in.
  ground.materials = [pbr];
  await running.advance(SETTLE_FRAMES * 4);

  // Boundary assertion: the scene is a Lite 1.34.0 scene.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const stall = stallAfterFirstGroup(running.renderer.scene as unknown as RebuildInternals);
  // A second light is a topology change, so the render sync system rebuilds every group.
  const right = addLight("Right", 6, false);
  await framesUntil(running, () => stall.isStalled());
  expect(running.renderer.isRebuildInFlight).toBe(true);

  right.shadows.enabled = true;
  await running.advance(SETTLE_FRAMES);
  expect(right.isCastingShadows).toBe(false);

  stall.release();
  await framesUntil(running, () => right.isCastingShadows && !running.renderer.isRebuildInFlight);
  await running.advance(SETTLE_FRAMES);
  expect(running.errors).toEqual([]);
  expect(device.errors).toEqual([]);
}, 60_000);
