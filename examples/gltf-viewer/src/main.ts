// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import {
  Camera,
  createApp,
  createMaterialAsset,
  Environment,
  isIgnifxError,
  Light,
  MeshAsset,
  MeshRenderer,
  Model,
  pbrMaterialDefinition,
  PostProcessStack,
} from "@ignifx/core";
// Vite virtual modules the plugin serves, typed by `@ignifx/vite-plugin/client`.
import { manifest } from "virtual:ignifx/manifest";
import { OrbitCamera } from "./orbit-camera.ts";
import type { App, EnvironmentAsset, ModelAsset } from "@ignifx/core";

/**
 * A glTF viewer: one `.glb` loaded through `app.assets`, image-based lighting from a `.env`
 * probe, a drag-to-orbit camera, and a bloom + SMAA post-process chain.
 *
 * `@ignifx/input` does not exist yet (Phase 3), so the orbit control listens to pointer events on
 * the canvas directly. That is the only part of this file a later phase will replace.
 *
 * Query flags, used by the visual golden suite (`tests/visual/`):
 *
 * - `?post=1` turns the post-process chain on. The `postProcessing` rendering feature is declared in
 *   `ignifx.config.ts` either way — it picks the frame graph, so it cannot be toggled after
 *   `createApp` — and this flag only decides whether any effect is enabled.
 * - `?static=1` stops time, so the frame is reproducible.
 *
 * `window.__ignifxReady` resolves to `"ready"` once a settled frame is on screen, or to
 * `"unsupported"` when the browser has no WebGPU.
 */

declare global {
  interface Window {
    /** Resolves once the first settled frame is on screen. See the module comment. */
    __ignifxReady: Promise<AppStatus>;
  }
}

/** What `window.__ignifxReady` resolves to. */
type AppStatus = "ready" | "unsupported";

/** How many animation frames the scene is given before the image is called settled. */
const SETTLE_FRAMES = 30;

/** The address of the model, relative to the asset root in `vite.config.ts`. */
const MODEL_ADDRESS = "Box.glb";

/** The address of the environment probe. */
const ENVIRONMENT_ADDRESS = "studio.env";

let announceReady: (status: AppStatus) => void = noop;
window.__ignifxReady = new Promise<AppStatus>((resolve) => {
  announceReady = resolve;
});

/** The placeholder `announceReady` holds until the promise below hands over its resolver. */
function noop(): void {
  // Nothing to do: the promise executor runs synchronously and replaces this on the next line.
}

/**
 * Waits for one animation frame.
 *
 * @returns A promise that resolves inside the next frame callback.
 */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Waits for several animation frames, so a newly built scene has presented.
 *
 * @param frames - How many frames to wait for.
 * @returns A promise that resolves after the last of them.
 */
function settle(frames: number): Promise<void> {
  let chain = Promise.resolve();
  for (let index = 0; index < frames; index += 1) {
    chain = chain.then(nextFrame);
  }
  return chain;
}

/** Swaps the canvas for the "no WebGPU here" panel in `index.html`. */
function showUnsupported(): void {
  document.body.dataset["webgpu"] = "unavailable";
}

/**
 * Builds the world: an orbit camera, a key light, an environment probe, the model, and a floor to
 * catch its shadow.
 *
 * @param app - The running app.
 * @param canvas - The element the orbit control listens to.
 * @param postProcess - Whether the effect chain is switched on.
 * @returns A promise that resolves once every asset is in the scene.
 */
async function buildScene(app: App, canvas: HTMLCanvasElement, postProcess: boolean): Promise<void> {
  app.registerComponents([OrbitCamera]);

  const eye = app.world.createEntity("Main Camera");
  eye.addComponent(Camera, { near: 0.05, far: 200, fov: 45 });
  eye.addComponent(OrbitCamera).bind(canvas);

  const sun = app.world.createEntity("Key Light");
  sun.transform.localPosition.set(2.5, 4, -2.5);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, { type: "directional", intensity: 2.2 });
  light.shadows.enabled = true;
  light.shadows.technique = "pcf";
  light.shadows.mapSize = 1024;

  // A low threshold, so `?post=1` is something you can see. The model is a mid-tone red on a dim
  // floor, so the 0.7 threshold this started with extracted nothing at all and the whole chain was
  // an expensive identity — the golden it produced was byte-identical to the plain scene.
  const stack = app.world.createEntity("Post").addComponent(PostProcessStack);
  stack.bloom.enabled = postProcess;
  stack.bloom.threshold = 0.02;
  stack.bloom.weight = 0.55;
  stack.bloom.kernel = 48;
  stack.smaa.enabled = postProcess;

  // A shadow catcher, so the key light's contribution is visible. `Box.glb` is two metres across
  // and centred on the origin, so the floor sits one metre below it.
  const floorMaterial = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "floor",
      baseColor: { r: 0.28, g: 0.3, b: 0.35, a: 1 },
      metallic: 0,
      roughness: 0.9,
    }),
    [],
  );
  const floor = app.world.createEntity("Floor");
  floor.transform.localPosition.set(0, -1, 0);
  floor.addComponent(MeshRenderer, {
    mesh: MeshAsset.ground(app, { width: 40, height: 40, subdivisions: 1 }),
    materials: [floorMaterial],
    castShadows: false,
    receiveShadows: true,
  });

  // A handle settles at a frame's delivery point, so the loop has to be running before anything is
  // awaited (`docs/architecture/05-assets-and-loading.md` §4).
  const [model, environment] = await Promise.all([
    app.assets.loadAsync<ModelAsset>(MODEL_ADDRESS),
    app.assets.loadAsync<EnvironmentAsset>(ENVIRONMENT_ADDRESS),
  ]);

  // The probe is a bare `.env`, not an `.environment.json` that names a skybox, so nothing is drawn
  // behind the model and the component's own clear colour is what the frame starts from.
  const sky = app.world.createEntity("Environment").addComponent(Environment, { environment });
  sky.clearColor = { r: 0.043, g: 0.059, b: 0.094, a: 1 };

  app.world.createEntity("Model").addComponent(Model, { model, castShadows: true, receiveShadows: false });
}

/**
 * Builds and runs the viewer.
 *
 * @returns The status `window.__ignifxReady` resolves to.
 */
async function main(): Promise<AppStatus> {
  const canvas = document.querySelector("#game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('gltf-viewer needs a <canvas id="game"> element on the page.');
  }

  const flags = new URLSearchParams(window.location.search);
  const frozen = flags.get("static") === "1";

  let app: App;
  try {
    app = await createApp({ canvas, settings: import.meta.env.IGNIFX_CONFIG, assets: { manifest } });
  } catch (error) {
    // IGX-0701 is the one failure a shipped game must handle itself: the browser has no WebGPU and
    // ignifx has no fallback renderer by decision (ADR-0001).
    if (isIgnifxError(error) && error.code === "IGX-0701") {
      showUnsupported();
      return "unsupported";
    }
    throw error;
  }

  if (frozen) {
    app.time.timeScale = 0;
  }
  await app.start();
  await buildScene(app, canvas, flags.get("post") === "1");
  await settle(SETTLE_FRAMES);
  app.log.info("gltf-viewer running:", app.renderer.drawCalls, "draw calls");
  return "ready";
}

void main().then(announceReady, (error: unknown) => {
  showUnsupported();
  announceReady("unsupported");
  // Rethrown out of the promise chain so it reaches `window.onerror` as an uncaught error rather
  // than a swallowed rejection. Examples never log through `console` (coding standards §6).
  setTimeout(() => {
    throw error;
  }, 0);
});
