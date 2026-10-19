import { f32, Script, Vec3 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { HostCapability, isSchemaSet, SceneNotification } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import type { EditorHost } from "../src/host.js";
import type { EditorPeer, Received } from "./support/editor.js";
import type { App, FetchLike, SceneFile } from "@ignifx/core";

/**
 * The scene view on a real WebGPU canvas: Lite's gizmo and the selection outline draw over the
 * scene, `pick` resolves what is under a point in both units, and `screenshot` encodes the view.
 * The headless suites cover everything else.
 */

/** The canvas size, in pixels. */
const WIDTH = 320;
const HEIGHT = 240;

/** The project's files, by address. */
const FILES: Readonly<Record<string, string>> = {
  "meshes/box.mesh.json": JSON.stringify({
    format: "ignifx.mesh",
    formatVersion: 1,
    primitive: "box",
    options: { size: 1 },
  }),
  "materials/red.material.json": JSON.stringify({
    format: "ignifx.material",
    formatVersion: 1,
    type: "pbr",
    name: "red",
    baseColor: [0.8, 0.1, 0.1, 1],
    metallic: 0,
    roughness: 0.8,
  }),
};

/** A box, lit, at the origin. */
const SCENE: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "box",
  entities: [
    {
      uid: "SUN",
      name: "Sun",
      parent: null,
      transform: { position: [0, 5, 0], rotation: [0.382683, 0, 0, 0.92388], scale: [1, 1, 1] },
      components: [{ uid: "SUN-L", type: "ignifx/Light", props: { type: "directional", intensity: 2 } }],
    },
    {
      uid: "BOX",
      name: "Box",
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [
        {
          uid: "BOX-R",
          type: "ignifx/MeshRenderer",
          props: { mesh: { $asset: "meshes/box.mesh.json" }, materials: [{ $asset: "materials/red.material.json" }] },
        },
      ],
    },
  ],
};

/** A glTF model, lit, at the origin: only its root node is tagged with its entity. */
const MODEL_SCENE: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "model",
  entities: [
    ...SCENE.entities.filter((entity) => entity.uid === "SUN"),
    {
      uid: "CRATE",
      name: "Crate",
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "CRATE-M", type: "ignifx/Model", props: { model: { $asset: "models/Box.glb" } } }],
    },
  ],
};

/**
 * Serves {@link FILES}, and the repository's `Box.glb` fixture.
 *
 * @param input - The request.
 * @returns The file, or a 404.
 */
const fetchFiles: FetchLike = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const address = url.replace(/^.*?assets\//u, "").replace(/^\//u, "");
  if (address === "models/Box.glb") {
    // Vitest's browser project serves the repository root.
    return fetch("/tests/fixtures/assets/Box.glb");
  }
  const body = FILES[address];
  return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : new Response(body));
};

/** A project script, registered the way a project's `main.ts` registers its scripts. */
class Spinner extends Script.define({ turnsPerSecond: f32(0.5, { step: 0.05, group: "Motion" }) }) {
  static typeId = "game/Spinner";
}

let host: EditorHost | null = null;
/** The `params` of the host's first `schemasChanged`. */
let announced: unknown = null;
let peer: EditorPeer | null = null;
let canvas: HTMLCanvasElement | null = null;

afterEach(() => {
  // The ratio override is an own property shadowing `Window.prototype`'s getter.
  Reflect.deleteProperty(globalThis, "devicePixelRatio");
  peer?.close();
  host?.dispose();
  canvas?.remove();
  host = null;
  peer = null;
  canvas = null;
  announced = null;
});

/**
 * Waits for animation frames.
 *
 * @param count - How many.
 */
async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one frame at a time is the point
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
}

/**
 * Counts the pixels of a frame close to the outline's orange.
 *
 * @param app - The app.
 * @returns How many pixels are outline-coloured.
 */
async function outlinePixels(app: App): Promise<number> {
  const capture = await app.renderer.captureScreenshot();
  let count = 0;
  for (let index = 0; index < capture.data.length; index += 4) {
    const r = capture.data[index] ?? 0;
    const g = capture.data[index + 1] ?? 0;
    const b = capture.data[index + 2] ?? 0;
    if (r > 200 && g > 110 && g < 200 && b < 80) {
      count += 1;
    }
  }
  return count;
}

/**
 * Counts the pixels that differ between two captures.
 *
 * @param left - One capture's bytes.
 * @param right - The other's.
 * @returns How many pixels differ by more than a little.
 */
function changedPixels(left: Uint8ClampedArray, right: Uint8ClampedArray): number {
  let count = 0;
  for (let index = 0; index < left.length; index += 4) {
    const delta =
      Math.abs((left[index] ?? 0) - (right[index] ?? 0)) +
      Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0)) +
      Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0));
    if (delta > 24) {
      count += 1;
    }
  }
  return count;
}

/**
 * Sends one request and returns its result.
 *
 * @param method - The method.
 * @param params - Its parameters.
 * @returns The result.
 */
async function call(method: string, params?: unknown): Promise<unknown> {
  const answer: Received | undefined = await peer?.request(method, params);
  if (answer === undefined || "error" in answer) {
    throw new Error(`${method} failed: ${JSON.stringify(answer)}`);
  }
  return answer["result"];
}

/**
 * Starts a host on a canvas, opens a scene, and frames an entity.
 *
 * @param scene - The scene to open.
 * @param framed - The uid to frame.
 * @returns The running host.
 */
async function sceneView(scene: SceneFile = SCENE, framed = "BOX"): Promise<EditorHost> {
  canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.width = `${String(WIDTH)}px`;
  canvas.style.height = `${String(HEIGHT)}px`;
  document.body.append(canvas);
  const target = new EventTarget();
  const starting = startEditorHost({
    editorOrigin: EDITOR_ORIGIN,
    canvas,
    messageTarget: target,
    // The engine's default: core's render overlay draws the gizmos at every MSAA setting (ADR-0031).
    settings: { rendering: { msaaSamples: 4 } },
    assets: { fetch: fetchFiles },
    heartbeatIntervalMs: 60_000,
    scripts: [Spinner],
  });
  peer = connect(target);
  const ready = await peer.hello();
  expect(ready).toHaveProperty("result.capabilities", [
    HostCapability.heartbeat,
    HostCapability.gizmos,
    HostCapability.screenshot,
  ]);
  host = await starting;
  announced = (await peer.nextNotification(SceneNotification.schemasChanged))["params"];
  await call("openScene", { file: scene, address: `scenes/${scene.name}.scene.json` });
  await call("frame", { entities: [framed] });
  await frames(6);
  return host;
}

describe("the scene view on a WebGPU canvas", () => {
  it("runs at the project's MSAA 4 and draws the outline and the gizmo on the selection", async () => {
    const view = await sceneView();
    const surface: unknown = Reflect.get(view.app.lite.scene, "surface");
    expect(typeof surface === "object" && surface !== null ? Reflect.get(surface, "msaaSamples") : null).toBe(4);

    const unselected = await view.app.renderer.captureScreenshot();
    expect(await outlinePixels(view.app)).toBe(0);

    await call("select", { entities: ["BOX"] });
    await call("setGizmo", { mode: "none", space: "world", snap: null });
    await frames(4);
    // One-pixel lines over the twelve edges of the box.
    expect(await outlinePixels(view.app)).toBeGreaterThan(20);
    const outlined = await view.app.renderer.captureScreenshot();

    await call("setGizmo", { mode: "translate", space: "world", snap: null });
    await frames(4);
    const withGizmo = await view.app.renderer.captureScreenshot();
    expect(changedPixels(outlined.data, withGizmo.data)).toBeGreaterThan(20);

    await call("select", { entities: [] });
    await frames(4);
    const cleared = await view.app.renderer.captureScreenshot();
    expect(changedPixels(unselected.data, cleared.data)).toBeLessThan(20);
  }, 60_000);

  it("picks the box in CSS and backing pixels at device pixel ratio 2, and misses beside it", async () => {
    // At ratio 2 the box's CSS point read as a backing point lies off the box, so a host that
    // skipped its conversion would miss.
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
    const view = await sceneView();
    // Framing the sun too leaves the box small and low in the view, with empty sky above it.
    await call("frame", { entities: "all" });
    await frames(2);
    const camera = view.app.world.mainCamera;
    const screen = new Vec3();
    expect(camera?.worldToScreen({ x: 0, y: 0, z: 0 }, screen)).toBe(true);
    const ratio = (canvas?.width ?? WIDTH) / (canvas?.clientWidth ?? WIDTH);
    expect(ratio).toBe(2);

    expect(await call("pick", { x: screen.x, y: screen.y, unit: "backing" })).toMatchObject({ entity: "BOX" });
    expect(await call("pick", { x: screen.x / ratio, y: screen.y / ratio, unit: "css" })).toMatchObject({
      entity: "BOX",
    });
    // The same numbers as backing pixels are off the box.
    expect(await call("pick", { x: screen.x / ratio, y: screen.y / ratio, unit: "backing" })).toEqual({
      entity: null,
      point: null,
      distance: null,
    });
    expect(await call("pick", { x: 2, y: 2, unit: "css" })).toEqual({ entity: null, point: null, distance: null });
    expect(await call("pick", { x: WIDTH * 4, y: 2, unit: "backing" })).toEqual({
      entity: null,
      point: null,
      distance: null,
    });
  }, 60_000);

  it("describes the project's scripts and core's components with their inspector metadata", async () => {
    await sceneView();
    expect(isSchemaSet(announced)).toBe(true);
    expect(announced).toHaveProperty(["schemas", "game/Spinner"], {
      title: "Spinner",
      format: "components",
      fields: { turnsPerSecond: { kind: "f32", default: 0.5, step: 0.05, group: "Motion" } },
      allowMultiple: true,
      package: "game",
      propsSchema: expect.objectContaining({ type: "object" }) as unknown,
    });
    expect(announced).toHaveProperty(["schemas", "ignifx/MeshRenderer", "package"], "@ignifx/core");
    expect(announced).toHaveProperty(["schemas", "ignifx/Transform", "builtIn"], true);
  }, 60_000);

  it("picks a glTF model through the renderer alone, in both units at device pixel ratio 2", async () => {
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
    const view = await sceneView(MODEL_SCENE, "CRATE");
    // The model loads after `openScene`; wait for it to reach the screen.
    await frames(20);
    expect(canvas?.width).toBe(WIDTH * 2);
    const camera = view.app.world.mainCamera;
    const screen = new Vec3();
    expect(camera?.worldToScreen({ x: 0, y: 0, z: 0 }, screen)).toBe(true);

    const backing = await call("pick", { x: screen.x, y: screen.y, unit: "backing" });
    expect(backing).toMatchObject({ entity: "CRATE" });
    expect(Reflect.get(Object(backing), "distance")).toBeGreaterThan(0);
    expect(await call("pick", { x: screen.x / 2, y: screen.y / 2, unit: "css" })).toMatchObject({ entity: "CRATE" });
    // A CSS point past the CSS width is inside the backing store's width, but outside the canvas.
    expect(await call("pick", { x: WIDTH + 1, y: screen.y / 2, unit: "css" })).toEqual({
      entity: null,
      point: null,
      distance: null,
    });
  }, 60_000);

  it("captures the view as a PNG or JPEG data URL at the requested size", async () => {
    await sceneView();
    expect(await call("screenshot", { width: 160, format: "png" })).toMatchObject({ width: 160, height: 120 });
    const jpeg = await call("screenshot", { format: "jpeg", quality: 0.8 });
    expect(jpeg).toMatchObject({ width: WIDTH, height: HEIGHT });
    expect(String(Reflect.get(Object(jpeg), "dataUrl"))).toMatch(/^data:image\/jpeg;base64,\/9j\//u);
  }, 60_000);
});
