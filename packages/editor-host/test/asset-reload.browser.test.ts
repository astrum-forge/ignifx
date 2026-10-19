import { Component, computeSceneHash, f32, stringifySceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { isAssetReloadedParams, SceneNotification } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import type { EditorHost } from "../src/host.js";
import type { EditorPeer } from "./support/editor.js";
import type { Entity, FetchLike, SceneFile, SceneFileEntity } from "@ignifx/core";

/**
 * Asset hot reload in a scene view on a real WebGPU canvas (engine ask E23): a prefab edited on
 * disk is reloaded through `app.assets.reload` and rebuilds the document's instance of it in place,
 * with its uid, transform, overrides and document children, and a mesh edited on disk is picked up
 * by its renderer; each sends `assetReloaded`.
 */

/** The canvas size, in pixels. */
const WIDTH = 160;
const HEIGHT = 120;

/** The prefab's address. */
const PREFAB = "prefabs/crate.prefab.json";

/** The mesh's address. */
const MESH = "meshes/box.mesh.json";

/** The prefab's root uid, inside the prefab file. */
const PREFAB_ROOT = "PREFAB-ROOT";

/** The instance root's document uid. */
const CRATE = "CRATE";

/** A document child the editor placed under the instance root. */
const LABEL = "LABEL";

/** The component the prefab carries, whose `mass` the document overrides. */
class CrateBody extends Component.define({ mass: f32(1), drag: f32(0) }) {
  static typeId = "game/CrateBody";
}

/** The handle the edited prefab adds. */
const HANDLE: SceneFileEntity = {
  uid: "PREFAB-HANDLE",
  name: "Handle",
  parent: PREFAB_ROOT,
  transform: { position: [0.6, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
};

/**
 * Builds a version of the crate prefab.
 *
 * @param lidHeight - Where the lid sits.
 * @param drag - The body's drag, which no override touches.
 * @param handle - Whether the prefab has a handle.
 * @returns The prefab file.
 */
function cratePrefab(lidHeight: number, drag: number, handle: boolean): SceneFile {
  return {
    format: "ignifx.scene",
    formatVersion: 1,
    name: "Crate",
    entities: [
      {
        uid: PREFAB_ROOT,
        name: "Crate",
        parent: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: [
          { uid: "PREFAB-BODY", type: "game/CrateBody", props: { mass: 1, drag } },
          { uid: "PREFAB-MESH", type: "ignifx/MeshRenderer", props: { mesh: { $asset: MESH, type: "mesh" } } },
        ],
      },
      {
        uid: "PREFAB-LID",
        name: "Lid",
        parent: PREFAB_ROOT,
        transform: { position: [0, lidHeight, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
      ...(handle ? [HANDLE] : []),
    ],
  };
}

/**
 * Builds the box mesh file.
 *
 * @param size - The box's edge.
 * @returns The file's text.
 */
function boxMesh(size: number): string {
  return JSON.stringify({ format: "ignifx.mesh", formatVersion: 1, primitive: "box", options: { size } });
}

/**
 * The level: a light, and one crate instance, moved, with its mass overridden and a label under it.
 *
 * @param hash - The prefab's hash, as the editor recorded it.
 * @returns The scene file.
 */
function level(hash: string): SceneFile {
  return {
    format: "ignifx.scene",
    formatVersion: 1,
    name: "level",
    entities: [
      {
        uid: "SUN",
        name: "Sun",
        parent: null,
        transform: { position: [0, 5, 0], rotation: [0.382683, 0, 0, 0.92388], scale: [1, 1, 1] },
        components: [{ uid: "SUN-L", type: "ignifx/Light", props: { type: "directional", intensity: 2 } }],
      },
      {
        uid: CRATE,
        name: "Crate",
        parent: null,
        transform: { position: [2, 0, -1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        instance: {
          scene: { $asset: PREFAB },
          hash,
          overrides: [{ path: `${PREFAB_ROOT}/components/PREFAB-BODY/props/mass`, value: 5 }],
        },
      },
      {
        uid: LABEL,
        name: "Label",
        parent: CRATE,
        transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    ],
  };
}

/** The project's files on disk, by address; a test edits them. */
const files = new Map<string, string>();

/**
 * Serves {@link files}.
 *
 * @param input - The request.
 * @returns The file, or a 404.
 */
const fetchFiles: FetchLike = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = files.get(url.replace(/^.*?assets\//u, "").replace(/^\//u, ""));
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
  files.clear();
});

/**
 * Sends one request and returns its result.
 *
 * @param method - The method.
 * @param params - Its parameters.
 * @returns The result.
 */
async function call(method: string, params?: unknown): Promise<unknown> {
  const answer = await peer?.request(method, params);
  if (answer === undefined || "error" in answer) {
    throw new Error(`${method} failed: ${JSON.stringify(answer)}`);
  }
  return answer["result"];
}

/**
 * Starts a host on a canvas and opens the level.
 *
 * @returns The running host.
 */
async function sceneView(): Promise<EditorHost> {
  files.set(PREFAB, stringifySceneFile(cratePrefab(0.5, 0, false)));
  files.set(MESH, boxMesh(1));
  canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.append(canvas);
  const target = new EventTarget();
  const starting = startEditorHost({
    editorOrigin: EDITOR_ORIGIN,
    canvas,
    messageTarget: target,
    assets: { fetch: fetchFiles },
    heartbeatIntervalMs: 60_000,
    scripts: [CrateBody],
  });
  peer = connect(target);
  await peer.hello();
  host = await starting;
  await peer.nextNotification(SceneNotification.schemasChanged);
  const hash = await computeSceneHash(cratePrefab(0.5, 0, false));
  await call("openScene", { file: level(hash), address: "scenes/level.scene.json" });
  await call("select", { entities: [CRATE] });
  return host;
}

/**
 * Writes a read-back as JSON with its hashes masked.
 *
 * @param value - The read-back.
 * @returns The JSON.
 */
function masked(value: unknown): string {
  return JSON.stringify(value).replaceAll(/sha256:[0-9a-f]+/gu, "<hash>");
}

/**
 * The live entity of a document uid.
 *
 * @param running - The host.
 * @param uid - The uid.
 * @returns The entity.
 */
function entity(running: EditorHost, uid: string): Entity {
  const found = running.app.world.getEntity(uid);
  if (found === null) {
    throw new Error(`No entity ${uid}.`);
  }
  return found;
}

/**
 * A child of an entity, by name.
 *
 * @param parent - The entity.
 * @param name - The child's name.
 * @returns The child, or `null`.
 */
function child(parent: Entity, name: string): Entity | null {
  return parent.children.find((candidate) => candidate.name === name) ?? null;
}

describe("asset hot reload in the scene view (E23)", () => {
  it("rebuilds a prefab instance from the edited prefab, keeping its uid, transform, overrides and children", async () => {
    const running = await sceneView();
    const before = entity(running, CRATE);
    expect(child(before, "Lid")?.transform.position.y).toBeCloseTo(0.5);
    expect(child(before, "Handle")).toBeNull();
    expect(before.getComponent(CrateBody)?.mass).toBe(5);

    const readBefore = await call("readBack", { entities: [CRATE, LABEL] });
    // The prefab changes on disk: a higher lid, some drag, and a handle.
    files.set(PREFAB, stringifySceneFile(cratePrefab(0.8, 0.25, true)));
    // The Vite plugin's `ignifx:asset-changed` payload, as the generated module hands it over.
    const payload = { address: PREFAB, kind: "changed", url: `/assets/${PREFAB}` } as const;
    const reloaded = running.assetChanged(payload);

    const notification = await peer?.nextNotification(SceneNotification.assetReloaded);
    expect(isAssetReloadedParams(notification?.["params"])).toBe(true);
    expect(notification?.["params"]).toEqual({ address: PREFAB, type: "scene", entities: [CRATE] });
    expect(await reloaded).toBe(true);

    // The same document uid, rebuilt: the new prefab, the document's own transform and override.
    const after = entity(running, CRATE);
    expect(after).not.toBe(before);
    expect(before.isDestroyed).toBe(true);
    expect([after.transform.position.x, after.transform.position.y, after.transform.position.z]).toEqual([2, 0, -1]);
    expect(child(after, "Lid")?.transform.position.y).toBeCloseTo(0.8);
    expect(child(after, "Handle")).not.toBeNull();
    expect(after.getComponent(CrateBody)?.mass).toBe(5);
    expect(after.getComponent(CrateBody)?.drag).toBeCloseTo(0.25);
    expect(entity(running, LABEL).parent).toBe(after);

    // What the editor's mirror check reads: the document's records, at the new prefab's hash.
    const read = await call("readBack", { entities: [CRATE, LABEL] });
    expect(read).toMatchObject({
      missing: [],
      entities: [
        {
          uid: CRATE,
          transform: { position: [2, 0, -1] },
          instance: {
            scene: { $asset: PREFAB },
            hash: await computeSceneHash(cratePrefab(0.8, 0.25, true)),
            overrides: [{ path: `${PREFAB_ROOT}/components/PREFAB-BODY/props/mass`, value: 5 }],
          },
        },
        { uid: LABEL, parent: CRATE },
      ],
    });
    // Everything else reads back as it did before the edit.
    expect(masked(read)).toBe(masked(readBefore));
    // The selection follows the rebuilt root, and the view still answers.
    expect(await call("select", { entities: [CRATE] })).toEqual({ entities: [CRATE] });
    await call("frame", { entities: [CRATE] });
  });

  it("swaps an edited mesh under its renderer, and leaves an asset it never loaded alone", async () => {
    const running = await sceneView();
    const handle = running.app.assets.get(MESH);
    expect(handle?.state).toBe("loaded");
    const before: unknown = handle?.value;
    const errors: unknown[] = [];
    running.app.onError.connect((report) => {
      errors.push(report.error);
    });

    files.set(MESH, boxMesh(2));
    expect(await running.assetChanged({ address: MESH, kind: "changed" })).toBe(true);
    const notification = await peer?.nextNotification(SceneNotification.assetReloaded);
    expect(notification?.["params"]).toEqual({ address: MESH, type: "mesh", entities: [] });
    expect(handle?.value).not.toBe(before);

    // A few frames draw the new mesh without an error.
    for (let index = 0; index < 3; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one frame at a time is the point
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    }
    expect(errors).toEqual([]);
    expect(await running.assetChanged({ address: "textures/never-loaded.png", kind: "changed" })).toBe(false);
    expect(await running.assetChanged({ address: MESH, kind: "removed" })).toBe(false);
  });
});
