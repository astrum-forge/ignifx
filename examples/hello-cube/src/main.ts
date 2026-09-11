// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import {
  Camera,
  createApp,
  createMaterialAsset,
  f32,
  isIgnifxError,
  Light,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
  Script,
} from "@ignifx/core";
import type { App, Entity, ScriptCallbacks } from "@ignifx/core";

/**
 * The smallest complete ignifx app: a camera, a shadow-casting directional light, a ground plane,
 * and a spinning PBR cube.
 *
 * Two query flags exist for the visual golden suite (`tests/visual/`) and are worth knowing about
 * anyway:
 *
 * - `?ortho=1` switches the camera to an orthographic projection.
 * - `?static=1` stops time and pins the cube at a fixed angle, so the frame is reproducible.
 *
 * `window.__ignifxReady` resolves to `"ready"` once the scene has presented a settled frame, or to
 * `"unsupported"` when the browser has no WebGPU. It is assigned before the first `await` so a test
 * can read it as soon as the document has loaded.
 */

declare global {
  interface Window {
    /** Resolves once the first settled frame is on screen. See the module comment. */
    __ignifxReady: Promise<AppStatus>;
  }
}

/** What `window.__ignifxReady` resolves to. */
type AppStatus = "ready" | "unsupported";

/** How many animation frames a scene is given before the image is called settled. */
const SETTLE_FRAMES = 12;

/** The cube's angle, in degrees about Y, when `?static=1` freezes the scene. */
const FROZEN_ANGLE_DEGREES = 30;

/** Spins its entity about Y. `speed` is a serialized field, in degrees per second. */
class Spinner extends Script.define({ speed: f32(45) }) implements ScriptCallbacks {
  static typeId = "hello-cube/Spinner";

  /** Reused so the per-frame path allocates nothing (coding standards §7). */
  readonly #step = { x: 0, y: 0, z: 0 };

  /**
   * Advances the rotation.
   *
   * @param dt - Seconds since the previous frame, already scaled by `time.timeScale`.
   */
  update(dt: number): void {
    this.#step.y = this.speed * dt;
    this.transform.rotate(this.#step);
  }
}

function noop(): void {
  // Nothing to do: the promise executor runs synchronously and replaces this on the next line.
}

let announceReady: (status: AppStatus) => void = noop;
window.__ignifxReady = new Promise<AppStatus>((resolve) => {
  announceReady = resolve;
});

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
 * Builds the world: a camera, a key light with a fill, a ground plane, and the cube.
 *
 * @param app - The running app.
 * @param orthographic - Whether the camera uses an orthographic projection.
 * @returns The cube's entity, so the caller can freeze its angle.
 */
function buildScene(app: App, orthographic: boolean): Entity {
  app.registerComponents([Spinner]);

  const eye = app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 2.6, -4.5);
  eye.transform.lookAt({ x: 0, y: 0.65, z: 0 });
  eye.addComponent(Camera, {
    near: 0.1,
    far: 100,
    fov: 55,
    projection: orthographic ? "orthographic" : "perspective",
    orthographicSize: 2.2,
  });

  const sun = app.world.createEntity("Sun");
  sun.transform.localPosition.set(-3.2, 6, -3.5);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, { type: "directional", intensity: 3.2 });
  light.shadows.enabled = true;
  light.shadows.technique = "pcf";
  light.shadows.mapSize = 1024;
  light.shadows.normalBias = 0.02;

  app.world.createEntity("Fill").addComponent(Light, {
    type: "hemispheric",
    intensity: 0.35,
    color: { r: 0.72, g: 0.79, b: 1, a: 1 },
  });

  const slate = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "slate",
      baseColor: { r: 0.22, g: 0.24, b: 0.29, a: 1 },
      metallic: 0,
      roughness: 0.95,
    }),
    [],
  );
  app.world.createEntity("Ground").addComponent(MeshRenderer, {
    mesh: MeshAsset.ground(app, { width: 24, height: 24, subdivisions: 1 }),
    materials: [slate],
    castShadows: false,
    receiveShadows: true,
  });

  const ember = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "ember",
      baseColor: { r: 0.93, g: 0.42, b: 0.16, a: 1 },
      metallic: 0.1,
      roughness: 0.35,
    }),
    [],
  );
  const cube = app.world.createEntity("Cube");
  cube.transform.localPosition.set(0, 0.65, 0);
  cube.addComponent(MeshRenderer, {
    mesh: MeshAsset.box(app, { size: 1.3 }),
    materials: [ember],
    castShadows: true,
    receiveShadows: false,
  });
  cube.addComponent(Spinner, { speed: 45 });
  return cube;
}

async function main(): Promise<AppStatus> {
  const canvas = document.querySelector("#game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('hello-cube needs a <canvas id="game"> element on the page.');
  }

  const flags = new URLSearchParams(window.location.search);
  let app: App;
  try {
    app = await createApp({ canvas, settings: import.meta.env.IGNIFX_CONFIG });
  } catch (error) {
    // IGX-0701 is the one failure a shipped game must handle itself: the browser has no WebGPU and
    // ignifx has no fallback renderer by decision (ADR-0001).
    if (isIgnifxError(error) && error.code === "IGX-0701") {
      showUnsupported();
      return "unsupported";
    }
    throw error;
  }

  const cube = buildScene(app, flags.get("ortho") === "1");
  if (flags.get("static") === "1") {
    cube.transform.localEulerAngles = { x: 0, y: FROZEN_ANGLE_DEGREES, z: 0 };
    app.time.timeScale = 0;
  }

  await app.start();
  await settle(SETTLE_FRAMES);
  app.log.info("hello-cube running:", app.renderer.drawCalls, "draw calls");
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
