import { physics } from "@ignifx/physics";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { HostCapability, RenderViewMethod, RpcErrorCode, SceneNotification } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import type { EditorHost, EditorHostOptions } from "../src/host.js";
import type { EditorPeer, Received } from "./support/editor.js";
import type { FetchLike, SceneFile } from "@ignifx/core";

/**
 * The render views on a real WebGPU canvas (engine ask E8): the Game panel's view renders the
 * document's own camera beside the editor camera, and `renderThumbnail` renders a model or a
 * prefab on a stage app of its own.
 */

/** The red box, unlit, so its colour is exact. */
const BOX_ENTITY = {
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
} as const;

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
    baseColor: [1, 0, 0, 1],
    unlit: true,
  }),
  "prefabs/red-box.prefab.json": JSON.stringify({
    format: "ignifx.scene",
    formatVersion: 1,
    name: "red-box",
    entities: [BOX_ENTITY],
  }),
};

/** The red box, and a camera 4 m in front of it looking at it. */
const SCENE: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "game",
  entities: [
    BOX_ENTITY,
    {
      uid: "EYE",
      name: "Main Camera",
      parent: null,
      transform: { position: [0, 0, -4], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "EYE-C", type: "ignifx/Camera", props: { fov: 40 } }],
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
    return fetch("/tests/fixtures/assets/Box.glb");
  }
  const body = FILES[address];
  return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : new Response(body));
};

let host: EditorHost | null = null;
let peer: EditorPeer | null = null;
let canvas: HTMLCanvasElement | null = null;

afterEach(() => {
  peer?.close();
  host?.dispose();
  canvas?.remove();
  host = null;
  peer = null;
  canvas = null;
});

/** Where Vitest's browser project serves `@babylonjs/havok`'s binary from. */
const HAVOK_URL = "/packages/physics/node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm";

/** The capabilities `ready` listed, from the last {@link sceneView}. */
let capabilities: unknown = null;

/**
 * Starts a scene view on a canvas and opens a scene, with the editor camera looking away from it.
 *
 * @param scene - The document.
 * @param extra - More host options, such as the project's extensions.
 * @returns The host.
 */
async function sceneView(
  scene: SceneFile,
  extra: Pick<EditorHostOptions, "extensions" | "createExtensions"> = {},
): Promise<EditorHost> {
  canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 64;
  canvas.style.width = "96px";
  canvas.style.height = "64px";
  document.body.append(canvas);
  const target = new EventTarget();
  const starting = startEditorHost({
    editorOrigin: EDITOR_ORIGIN,
    canvas,
    messageTarget: target,
    settings: { rendering: { clearColor: { r: 0.2, g: 0.2, b: 0.2, a: 1 } } },
    assets: { fetch: fetchFiles },
    heartbeatIntervalMs: 60_000,
    ...extra,
  });
  peer = connect(target);
  capabilities = Reflect.get(Object((await peer.hello())["result"]), "capabilities");
  host = await starting;
  await peer.nextNotification(SceneNotification.schemasChanged);
  await call("openScene", { file: scene, address: `scenes/${scene.name}.scene.json` });
  // A loaded scene's meshes join the render scene a frame or two later.
  for (let frame = 0; frame < 6; frame += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one frame at a time is the point
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
  return host;
}

/**
 * Sends a request and answers its result, failing on an error.
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
 * Decodes a data URL and reads one pixel of it.
 *
 * @param dataUrl - A PNG data URL.
 * @param x - The pixel x.
 * @param y - The pixel y.
 * @returns `[r, g, b]`.
 */
async function pixelOf(dataUrl: string, x: number, y: number): Promise<readonly number[]> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = surface.getContext("2d");
  if (context === null) {
    throw new Error("no 2D context");
  }
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(x, y, 1, 1).data;
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

/**
 * The `dataUrl` of an answer.
 *
 * @param result - The answer.
 * @returns The URL.
 */
function dataUrlOf(result: unknown): string {
  const dataUrl: unknown = Reflect.get(Object(result), "dataUrl");
  if (typeof dataUrl !== "string") {
    throw new TypeError(`no image: ${JSON.stringify(result)}`);
  }
  return dataUrl;
}

describe("the render views on a WebGPU canvas", () => {
  it("renders the document camera into the game view while the editor camera looks away", async () => {
    await sceneView(SCENE);
    // The editor camera frames nothing at the box, from far away.
    await call("frame", { entities: ["EYE"] });
    const off = await peer?.request(RenderViewMethod.gameViewFrame, { format: "png" });
    expect(off).toHaveProperty("error.code", RpcErrorCode.invalidRequest);
    expect(await call(RenderViewMethod.setGameView, { enabled: true, width: 64, height: 48 })).toEqual({
      enabled: true,
      width: 64,
      height: 48,
    });
    const frame = await call(RenderViewMethod.gameViewFrame, { format: "png" });
    expect(frame).toMatchObject({ width: 64, height: 48, camera: "EYE" });
    const [r, g, b] = await pixelOf(dataUrlOf(frame), 32, 24);
    expect(r, `game view centre ${String([r, g, b])}`).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(await call(RenderViewMethod.setGameView, { enabled: false })).toEqual({
      enabled: false,
      width: 64,
      height: 48,
    });
  });

  it("answers no image when the document has no camera", async () => {
    await sceneView({ ...SCENE, entities: [BOX_ENTITY] });
    await call(RenderViewMethod.setGameView, { enabled: true });
    expect(await call(RenderViewMethod.gameViewFrame, { format: "jpeg" })).toEqual({
      dataUrl: null,
      width: 640,
      height: 360,
      camera: null,
    });
  });

  it("renders thumbnails of a prefab and a model on their own stage", async () => {
    await sceneView(SCENE);
    const prefab = await call(RenderViewMethod.renderThumbnail, {
      asset: "prefabs/red-box.prefab.json",
      size: 32,
      format: "png",
    });
    expect(prefab).toMatchObject({ width: 32, height: 32 });
    const [r, g, b] = await pixelOf(dataUrlOf(prefab), 16, 16);
    expect(r, `prefab centre ${String([r, g, b])}`).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    const corner = await pixelOf(dataUrlOf(prefab), 0, 0);
    expect(corner[0]).toBeLessThan(100);
    const model = await call(RenderViewMethod.renderThumbnail, {
      asset: { $asset: "models/Box.glb", type: "model" },
      format: "png",
    });
    expect(model).toMatchObject({ width: 128, height: 128 });
    const centre = await pixelOf(dataUrlOf(model), 64, 64);
    const edge = await pixelOf(dataUrlOf(model), 0, 0);
    expect(
      Math.abs((centre[0] ?? 0) - (edge[0] ?? 0)) + Math.abs((centre[1] ?? 0) - (edge[1] ?? 0)),
      `model ${String(centre)} vs ${String(edge)}`,
    ).toBeGreaterThan(30);
    const unknown = await peer?.request(RenderViewMethod.renderThumbnail, { asset: "sounds/boom.ogg", format: "png" });
    expect(unknown).toHaveProperty("error.code", RpcErrorCode.invalidParams);
    // The stage is a second app on its own device, created and started by the first request.
  }, 60_000);

  it("builds the thumbnail stage from fresh extensions, leaving the scene view's physics world alone", async () => {
    const wasmBinary = await (await fetch(HAVOK_URL)).arrayBuffer();
    const view = await sceneView(SCENE, {
      extensions: [physics({ wasmBinary })],
      createExtensions: () => [physics({ wasmBinary })],
    });
    expect(capabilities).toContain(HostCapability.thumbnails);
    const world = view.app.physics.lite.world;
    const thumbnail = await call(RenderViewMethod.renderThumbnail, {
      asset: "prefabs/red-box.prefab.json",
      size: 16,
      format: "png",
    });
    expect(thumbnail).toMatchObject({ width: 16, height: 16 });
    expect(view.app.physics.lite.world).toBe(world);
    await call("applyOps", {
      ops: [
        { op: "setTransform", entity: "BOX", after: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      ],
      commandName: "Move",
      commandId: "move-1",
    });
    expect(view.app.physics.lite.world).toBe(world);
  }, 60_000);

  it("does not list thumbnails when it cannot build fresh extensions for the stage", async () => {
    const wasmBinary = await (await fetch(HAVOK_URL)).arrayBuffer();
    await sceneView(SCENE, { extensions: [physics({ wasmBinary })] });
    expect(capabilities).not.toContain(HostCapability.thumbnails);
    const refused = await peer?.request(RenderViewMethod.renderThumbnail, { asset: "a.glb", format: "png" });
    expect(refused).toHaveProperty("error.code", RpcErrorCode.methodNotFound);
  });
});
