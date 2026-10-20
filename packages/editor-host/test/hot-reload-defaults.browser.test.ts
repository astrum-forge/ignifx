import { Component, computeSceneHash, f32, stringifySceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { HostCapability, SceneNotification } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import { brightnessIn, Lamp, LAMP_POST, LampBrighter, level, PREFAB } from "./support/lamps.js";
import type { EditorHost } from "../src/host.js";
import type { EditorPeer } from "./support/editor.js";
import type { FetchLike } from "@ignifx/core";

/**
 * A script's hot reload that changes a field's default, in a scene view on a real WebGPU canvas
 * (engine ask E25): every field the document leaves out takes the new default in the live world,
 * a field it sets keeps its value, and a prefab instance keeps its prefab's values and its overrides.
 */

/** The canvas size, in pixels. */
const WIDTH = 160;
const HEIGHT = 120;

/** The project's files, by address. */
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
 * Starts a host on a canvas and opens the street.
 *
 * @returns The running host.
 */
async function sceneView(): Promise<EditorHost> {
  files.set(PREFAB, stringifySceneFile(LAMP_POST));
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
    scripts: [Lamp],
  });
  peer = connect(target);
  const ready = await peer.hello();
  expect(ready).toHaveProperty("result.capabilities", expect.arrayContaining([HostCapability.hotReloadDefaults]));
  host = await starting;
  await peer.nextNotification(SceneNotification.schemasChanged);
  await call("openScene", { file: level(await computeSceneHash(LAMP_POST)), address: "scenes/street.scene.json" });
  return host;
}

/**
 * The `brightness` a live lamp holds.
 *
 * @param running - The host.
 * @param uid - The component's uid, or the name of a prefab member under the lamp post.
 * @returns The value.
 */
function brightness(running: EditorHost, uid: string): unknown {
  const world = running.app.world;
  return brightnessIn(
    world.scenes.flatMap((scene) => scene.roots),
    world.getEntity("STREET-POST"),
    uid,
  );
}

/**
 * Reloads the script with its new default, waits for `schemasChanged`, and lets the host finish.
 *
 * @param running - The host.
 */
async function reloadBrighter(running: EditorHost): Promise<void> {
  const report = running.app.hotReload.apply([{ types: [LampBrighter] }]);
  expect(report.typeIds).toEqual(["game/Lamp"]);
  await peer?.nextNotification(SceneNotification.schemasChanged);
  // Requests queue behind the host's work on the new defaults.
  await call("readBack", { entities: [] });
}

describe("changed defaults after a script's hot reload (E25)", () => {
  it("gives the fields the document leaves out the new default, and keeps the ones it sets", async () => {
    const running = await sceneView();
    expect(brightness(running, "OMITS-LAMP")).toBe(1);
    expect(brightness(running, "SETS-LAMP")).toBe(1);
    const postBefore = running.app.world.getEntity("STREET-POST");

    await reloadBrighter(running);

    expect(brightness(running, "OMITS-LAMP")).toBe(4);
    expect(brightness(running, "SETS-LAMP")).toBe(1);
    expect(brightness(running, "SIGN-LAMP")).toBe(4);
    // The document's own radius is left as the file sets it.
    const read = await call("readBack", { entities: ["OMITS", "SETS", "SIGN"] });
    expect(read).toMatchObject({
      entities: [
        { uid: "OMITS", components: [{ uid: "OMITS-LAMP", props: { brightness: 4, radius: 5 } }] },
        { uid: "SETS", components: [{ uid: "SETS-LAMP", props: { brightness: 1, radius: 2 } }] },
        { uid: "SIGN", components: [{ uid: "SIGN-LAMP", props: { brightness: 4, radius: 2 } }] },
      ],
    });

    // The lamp post is rebuilt from its prefab: what the prefab leaves out takes the new default,
    // what it sets and what the instance overrides are kept, and the sign stays under the post.
    const post = running.app.world.getEntity("STREET-POST");
    expect(post).not.toBe(postBefore);
    expect(brightness(running, "Lamp Post")).toBe(4);
    expect(brightness(running, "Bulb")).toBe(3);
    expect(brightness(running, "Spare")).toBe(7);
    expect(running.app.world.getEntity("SIGN")?.parent).toBe(post);
    // Its overrides read back as the document's, not the stale members' old default.
    expect(await call("readBack", { entities: ["STREET-POST"] })).toMatchObject({
      entities: [
        {
          uid: "STREET-POST",
          instance: { overrides: [{ path: "SPARE/components/SPARE-LAMP/props/brightness", value: 7 }] },
        },
      ],
    });
  });

  it("follows the document's ops: an added component, a set field and a removed one", async () => {
    const running = await sceneView();
    await call("applyOps", {
      commandId: "c1",
      commandName: "Edit lamps",
      ops: [
        { op: "addComponent", entity: "SETS", component: { uid: "ADDED-LAMP", type: "game/Lamp", props: {} } },
        { op: "setProp", component: "OMITS-LAMP", path: ["brightness"], value: 1 },
        { op: "setProp", component: "SETS-LAMP", path: ["brightness"] },
      ],
    });

    await reloadBrighter(running);

    expect(brightness(running, "ADDED-LAMP")).toBe(4);
    expect(brightness(running, "OMITS-LAMP")).toBe(1);
    expect(brightness(running, "SETS-LAMP")).toBe(4);
  });

  it("leaves the world alone when a reload keeps every default", async () => {
    const running = await sceneView();
    await call("applyOps", {
      commandId: "c1",
      commandName: "Brighten",
      ops: [{ op: "setProp", component: "OMITS-LAMP", path: ["radius"], value: 9 }],
    });
    const post = running.app.world.getEntity("STREET-POST");

    class LampAgain extends Component.define({ brightness: f32(1), radius: f32(2) }) {
      static typeId = "game/Lamp";
    }
    running.app.hotReload.apply([{ types: [LampAgain] }]);
    await peer?.nextNotification(SceneNotification.schemasChanged);
    await call("readBack", { entities: [] });

    expect(running.app.world.getEntity("STREET-POST")).toBe(post);
    expect(brightness(running, "OMITS-LAMP")).toBe(1);
  });
});
