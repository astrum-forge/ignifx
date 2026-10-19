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
import type { ErrorReport } from "../../src/app/types.js";

/**
 * Scene changes that land while a renderable rebuild is in flight (`src/lite/shadow.ts`,
 * `rebuildAcrossMaterialSwaps`; `src/render/light.ts`, `#applyShadows`).
 *
 * On a loaded machine a rebuild spans frames, and the frames go on changing the scene. Both cases
 * here made `late-first-pbr-build-shadow.browser.test.ts` fail on CI runners: a ground switched to
 * PBR while the Standard group was being rebuilt, and a shadow switched on between two groups.
 */

let harness: BrowserApp | null = null;

/** The current test's device error collector, so `afterEach` can read what arrives after dispose. */
let device: { readonly errors: string[]; stop(): void } | null = null;

afterEach(async () => {
  const running = harness;
  const collector = device;
  harness = null;
  device = null;
  if (running === null) {
    return;
  }
  const reported = running.errors.length;
  const rejected = collector?.errors.length ?? 0;
  running.dispose();
  // A rebuild still in flight finishes after dispose; whatever it reports belongs to this test.
  await running.advance(SETTLE_FRAMES);
  const late = {
    errors: running.errors.slice(reported).map(describeReport),
    device: collector?.errors.slice(rejected) ?? [],
  };
  expect(late, "errors reported after the app was disposed").toEqual({ errors: [], device: [] });
});

/**
 * One error report as text, with its stack and where it came from.
 *
 * @param report - The report.
 * @returns The text.
 */
function describeReport(report: ErrorReport): string {
  const error = report.error;
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return `${report.source}/${String(report.phase)}: ${text}`;
}

/**
 * The state worth reading when an assertion about errors fails.
 *
 * @param running - The harness.
 * @returns A message for `expect`.
 */
function diagnostics(running: BrowserApp): string {
  const renderer = running.renderer;
  return JSON.stringify(
    {
      errors: running.errors.map(describeReport),
      device: device?.errors ?? [],
      renderableRebuilds: renderer.renderableRebuilds,
      isRebuildInFlight: renderer.isRebuildInFlight,
      unconfirmed: renderer.materialCacheResets.unconfirmed,
      retries: renderer.materialCacheResets.retries,
    },
    null,
    2,
  );
}

/**
 * Asserts that neither the app nor the device reported anything, with the state that explains it
 * when either did.
 *
 * @param running - The harness.
 */
function expectNoErrors(running: BrowserApp): void {
  const message = diagnostics(running);
  expect(running.errors.map(describeReport), message).toEqual([]);
  expect(device?.errors ?? [], message).toEqual([]);
}

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

/** The most frames {@link framesUntil} waits before it gives up. */
const MAX_WAIT_FRAMES = 600;

/**
 * Waits for real frames until a condition holds. A rebuild takes as many frames as the machine
 * makes it take, so the tests wait on what they need rather than on a frame count.
 *
 * @param running - The harness.
 * @param what - What is being waited for, for the error.
 * @param done - The condition, read before each frame.
 * @param left - How many more frames to wait.
 * @returns A promise that settles once `done` holds.
 * @throws Error when it still does not hold after {@link MAX_WAIT_FRAMES} frames.
 */
async function framesUntil(
  running: BrowserApp,
  what: string,
  done: () => boolean,
  left = MAX_WAIT_FRAMES,
): Promise<void> {
  if (done()) {
    return;
  }
  if (left <= 0) {
    throw new Error(`Still waiting for ${what} after ${String(MAX_WAIT_FRAMES)} frames.\n${diagnostics(running)}`);
  }
  await running.nextFrame();
  return framesUntil(running, what, done, left - 1);
}

/**
 * Waits until the render sync system has run a rebuild after `before` and owes no more.
 *
 * @remarks
 * The rebuild a change asks for starts a frame later (`#rebuildRenderables`), and a family built for
 * the first time asks for one more to confirm its cache reset. So the test waits for the count to
 * move, for nothing to be in flight or unconfirmed, and then for a few frames in which no new
 * rebuild starts.
 *
 * @param running - The harness.
 * @param before - `renderer.renderableRebuilds` before the change.
 * @param rounds - How many more times a late rebuild may restart the wait.
 * @returns A promise that settles once the rebuilds are done.
 */
async function rebuildsDone(running: BrowserApp, before: number, rounds = 10): Promise<void> {
  const renderer = running.renderer;
  await framesUntil(
    running,
    "the owed rebuilds",
    () =>
      renderer.renderableRebuilds > before && !renderer.isRebuildInFlight && !renderer.materialCacheResets.unconfirmed,
  );
  const count = renderer.renderableRebuilds;
  await running.advance(SETTLE_FRAMES);
  if ((renderer.renderableRebuilds !== count || renderer.isRebuildInFlight) && rounds > 0) {
    return rebuildsDone(running, count, rounds - 1);
  }
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
  device = gpuDeviceErrors();
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
  const before = running.renderer.renderableRebuilds;
  addLight("Right", 6, false);
  await framesUntil(running, "the swap", hasSwapped);
  await rebuildsDone(running, before);

  expect(running.renderer.materialCacheResets.retries, diagnostics(running)).toBeGreaterThan(0);
  expectNoErrors(running);
}, 60_000);

it("switches a shadow on only once the rebuild in flight has finished", async () => {
  device = gpuDeviceErrors();
  const { running, ground, pbr, addLight } = await buildScene();
  device.stop();
  // Two families, so a rebuild has a gap between groups for a generator to land in.
  const swapped = running.renderer.renderableRebuilds;
  ground.materials = [pbr];
  // Lite builds the PBR family on its own; the sync system then owes a rebuild to confirm its reset.
  await rebuildsDone(running, swapped);

  // Boundary assertion: the scene is a Lite 1.34.0 scene.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const stall = stallAfterFirstGroup(running.renderer.scene as unknown as RebuildInternals);
  // A second light is a topology change, so the render sync system rebuilds every group.
  const right = addLight("Right", 6, false);
  await framesUntil(running, "the stall", () => stall.isStalled());
  expect(running.renderer.isRebuildInFlight).toBe(true);

  right.shadows.enabled = true;
  await running.advance(SETTLE_FRAMES);
  expect(right.isCastingShadows).toBe(false);

  const stalled = running.renderer.renderableRebuilds;
  stall.release();
  await framesUntil(running, "the generator", () => right.isCastingShadows);
  // The generator attaches on the first frame after the stalled rebuild; its own rebuild follows.
  await rebuildsDone(running, stalled);
  expectNoErrors(running);
}, 60_000);

it("keeps a destroyed caster's light and generator in the scene until the rebuild in flight has finished", async () => {
  device = gpuDeviceErrors();
  const { running, ground, pbr, addLight } = await buildScene();
  device.stop();
  const before = running.renderer.renderableRebuilds;
  ground.materials = [pbr];
  const right = addLight("Right", 6, true);
  await framesUntil(running, "the generator", () => right.isCastingShadows);
  await rebuildsDone(running, before);
  const liteLight = right.lite.light;
  expect(liteLight).not.toBeNull();

  // Boundary assertion: the scene is a Lite 1.34.0 scene.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const stall = stallAfterFirstGroup(running.renderer.scene as unknown as RebuildInternals);
  addLight("Top", 0.5, false);
  await framesUntil(running, "the stall", () => stall.isStalled());

  right.entity.destroy();
  await running.advance(SETTLE_FRAMES);
  expect(running.renderer.scene.lights).toContain(liteLight);

  const stalled = running.renderer.renderableRebuilds;
  stall.release();
  await framesUntil(running, "the stalled rebuild", () => !running.renderer.isRebuildInFlight);
  expect(running.renderer.scene.lights).not.toContain(liteLight);
  // A destroyed light owes no rebuild of the sync system's own, so only the stalled one is waited on.
  await rebuildsDone(running, stalled - 1);
  expectNoErrors(running);
}, 60_000);
