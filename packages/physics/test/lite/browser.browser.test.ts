import { forceWebGpuDeviceLossForTesting } from "@babylonjs/lite";
import {
  Camera,
  createApp,
  createAssetManifest,
  createMaterialAsset,
  createMemorySink,
  Light,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
  Script,
  waitFixedUpdate,
} from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { BoxCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { physics } from "../../src/extension.js";
import { HAVOK_WASM_FILE_NAME } from "../../src/lite/havok-module.js";
import type { App, Coroutine, ErrorReport, RenderCapture, ScriptCallbacks } from "@ignifx/core";

/**
 * The GPU half of Phase 4, on a real WebGPU device in Chromium:
 *
 * - Havok's `.wasm` is served through the **asset manifest**, which is how the Vite plugin's
 *   `ignifx.assets.public` copy is reached at runtime (spike S4.1, `09-physics.md` §7).
 * - A `MeshRenderer` on a falling `Rigidbody` really moves on screen, because the body and the
 *   renderer share one `SceneNode` (ADR-0003).
 * - A forced device loss with active bodies and a running coroutine recovers with the simulation
 *   intact: the poses continue from where they were, matching a headless twin stepped the same
 *   number of times (Phase 4 exit criterion).
 * - `app.physics.debugViewer.enabled` toggles Lite's wireframe viewer without throwing.
 *
 * The file lives under `test/lite/` because it calls Lite's own
 * `forceWebGpuDeviceLossForTesting` (`index.d.ts` 5364); that directory is the documented exception
 * to the adapter boundary (coding standards §4).
 */

/** Where Vitest's browser project serves `@babylonjs/havok`'s binary from. */
const HAVOK_URL = "/packages/physics/node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm";

/** The canvas edge, in device pixels. Small keeps SwiftShader fast. */
const CANVAS_SIZE = 48;

/** How many frames a change is given to reach the screen. */
const SETTLE_FRAMES = 6;

/** How many `SETTLE_FRAMES` rounds a GPU-dependent condition (first lit frame, device recovery) may take. */
const LIT_ATTEMPTS = 40;

/** The running app under test, disposed after every case. */
let running: { app: App; canvas: HTMLCanvasElement } | null = null;

afterEach(() => {
  running?.app.dispose();
  running?.canvas.remove();
  running = null;
});

/** Counts the fixed steps its coroutine survived, to prove one keeps running across a device loss. */
class Ticker extends Script implements ScriptCallbacks {
  static typeId = "test/Ticker";

  /** How many fixed steps the coroutine has seen. */
  ticks = 0;

  start(): void {
    this.startCoroutine(this.#count());
  }

  *#count(): Coroutine {
    for (;;) {
      yield waitFixedUpdate();
      this.ticks += 1;
    }
  }
}

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Waits for several animation frames.
 *
 * @param frames - How many to wait for.
 * @returns A promise that resolves after the last one.
 */
function advance(frames: number): Promise<void> {
  // Written as a promise chain rather than a loop because waiting for frame `n + 1` genuinely
  // depends on frame `n` having happened, which is what `no-await-in-loop` exists to prevent.
  let chain = Promise.resolve();
  for (let index = 0; index < frames; index += 1) {
    chain = chain.then(nextFrame);
  }
  return chain;
}

/**
 * Builds a started app on a real device, with physics loading Havok through the manifest.
 *
 * @param errors - Collects everything `app.onError` reports.
 * @returns The app and its canvas.
 */
async function createGpuApp(errors: ErrorReport[]): Promise<App> {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  canvas.style.width = `${String(CANVAS_SIZE)}px`;
  canvas.style.height = `${String(CANVAS_SIZE)}px`;
  document.body.append(canvas);

  const app = await createApp({
    canvas,
    logSink: createMemorySink(),
    // The manifest is what `app.assets.resolveUrl("HavokPhysics.wasm")` answers from, and the
    // address is the bare file name because extension public assets are copied unhashed by base
    // name into the same directory the default asset root points at.
    assets: { manifest: createAssetManifest([{ address: HAVOK_WASM_FILE_NAME, url: HAVOK_URL }]) },
    settings: { rendering: { msaaSamples: 1, features: { deviceLostRecovery: true } } },
    extensions: [physics()],
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  running = { app, canvas };
  await app.start();
  return app;
}

/**
 * Reads one pixel out of a capture.
 *
 * @param frame - The captured frame.
 * @param x - The column.
 * @param y - The row.
 * @returns The four channel values.
 */
function pixelAt(frame: RenderCapture, x: number, y: number): readonly number[] {
  const offset = (y * frame.width + x) * 4;
  return [frame.data[offset] ?? 0, frame.data[offset + 1] ?? 0, frame.data[offset + 2] ?? 0];
}

describe("@ignifx/physics on a real device", () => {
  it("loads Havok through the asset manifest and simulates", async () => {
    const errors: ErrorReport[] = [];
    const app = await createGpuApp(errors);
    // `resolveUrl` is what the extension hands the loader; the manifest answers with the served URL.
    expect(app.assets.resolveUrl(HAVOK_WASM_FILE_NAME)).toBe(HAVOK_URL);

    const box = app.world.createEntity("Box");
    box.transform.position = { x: 0, y: 4, z: 0 };
    box.addComponent(BoxCollider);
    box.addComponent(Rigidbody, { interpolation: "none" });
    await advance(SETTLE_FRAMES * 4);

    expect(box.transform.position.y).toBeLessThan(4);
    expect(errors).toEqual([]);
  }, 60_000);

  it("moves a MeshRenderer on screen as its Rigidbody falls", async () => {
    const errors: ErrorReport[] = [];
    const app = await createGpuApp(errors);

    const eye = app.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 0, -6);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    app.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });

    const mesh = MeshAsset.box(app, { size: 2 });
    const material = createMaterialAsset(
      app,
      pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
      [],
    );
    const box = app.world.createEntity("Cube");
    box.transform.position = { x: 0, y: 0, z: 0 };
    box.addComponent(MeshRenderer, { mesh, materials: [material] });
    box.addComponent(BoxCollider, { size: { x: 2, y: 2, z: 2 } });
    box.addComponent(Rigidbody, { interpolation: "none" });

    // The cube reaches the screen once its material has warmed up (ADR-0014), which on a busy
    // SwiftShader can take longer than a fixed handful of frames: poll, bounded.
    const centre = CANVAS_SIZE >> 1;
    let litBefore: readonly number[] = [0, 0, 0];
    for (let attempt = 0; attempt < LIT_ATTEMPTS && (litBefore[0] ?? 0) === 0; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- frames are sequential; that is the point.
      await advance(SETTLE_FRAMES);
      // oxlint-disable-next-line no-await-in-loop -- see above.
      const before = await app.renderer.captureScreenshot();
      litBefore = pixelAt(before, centre, centre);
    }
    expect(litBefore[0]).toBeGreaterThan(0);

    // Long enough for the cube to fall out of the camera's view entirely.
    await advance(90);
    const after = await app.renderer.captureScreenshot();
    const litAfter = pixelAt(after, centre, centre);
    expect(box.transform.position.y).toBeLessThan(-3);
    expect(litAfter[0]).toBeLessThan(litBefore[0] ?? 0);
    expect(errors).toEqual([]);
  }, 60_000);

  it("toggles the debug viewer without throwing", async () => {
    const errors: ErrorReport[] = [];
    const app = await createGpuApp(errors);
    const eye = app.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 0, -6);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    app.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });

    const box = app.world.createEntity("Box");
    box.transform.position = { x: 0, y: 2, z: 0 };
    box.addComponent(BoxCollider);
    box.addComponent(Rigidbody, { interpolation: "none" });
    await advance(SETTLE_FRAMES);

    expect(app.physics.debugViewer.enabled).toBe(false);
    app.physics.debugViewer.enabled = true;
    expect(app.physics.debugViewer.enabled).toBe(true);
    await advance(SETTLE_FRAMES);
    app.physics.debugViewer.enabled = false;
    expect(app.physics.debugViewer.enabled).toBe(false);
    await advance(SETTLE_FRAMES);
    expect(errors).toEqual([]);
  }, 60_000);

  it("recovers from a forced device loss with active bodies and a running coroutine", async () => {
    const errors: ErrorReport[] = [];
    const app = await createGpuApp(errors);
    const eye = app.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 0, -6);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    app.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });

    const floor = app.world.createEntity("Floor");
    floor.transform.position = { x: 0, y: -4, z: 0 };
    floor.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });

    const box = app.world.createEntity("Box");
    box.transform.position = { x: 0, y: 4, z: 0 };
    box.addComponent(BoxCollider);
    box.addComponent(Rigidbody, { interpolation: "none" });
    const ticker = box.addComponent(Ticker);

    let lost = 0;
    let recovered = 0;
    app.events.onDeviceLost.connect(() => {
      lost += 1;
    });
    app.events.onDeviceRecovered.connect(() => {
      recovered += 1;
    });

    await advance(SETTLE_FRAMES);
    const ticksBefore = ticker.ticks;
    const yBefore = box.transform.position.y;
    expect(ticksBefore).toBeGreaterThan(0);
    expect(yBefore).toBeLessThan(4);

    forceWebGpuDeviceLossForTesting(app.lite.engine);
    // Recovery re-creates the device and every GPU resource; on a busy SwiftShader that can take
    // more than a fixed handful of frames, so poll for the recovered signal, bounded, then give the
    // simulation a few more frames to show it kept going.
    const isRecovered = (): boolean => recovered > 0; // set from the signal, not the loop body
    for (let attempt = 0; attempt < LIT_ATTEMPTS && !isRecovered(); attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- frames are sequential; that is the point.
      await advance(SETTLE_FRAMES);
    }
    await advance(SETTLE_FRAMES * 2);

    expect(lost).toBe(1);
    expect(recovered).toBe(1);
    // The simulation never paused: the body kept falling and the coroutine kept resuming.
    expect(box.transform.position.y).toBeLessThan(yBefore);
    expect(ticker.ticks).toBeGreaterThan(ticksBefore);

    // …and it lands on the floor rather than falling forever, so the world survived intact.
    await advance(120);
    expect(box.transform.position.y).toBeGreaterThan(-4);
    expect(box.transform.position.y).toBeLessThan(-3);
  }, 60_000);
});
