import { Component, computeSceneHash, f32, stringifySceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { SceneNotification } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import { brightnessIn, Lamp, LAMP_POST, LampBrighter, level, PREFAB } from "./support/lamps.js";
import type { EditorHost } from "../src/host.js";
import type { EditorPeer } from "./support/editor.js";
import type { ConcreteComponentType, FetchLike, SceneFile } from "@ignifx/core";

/**
 * A script's hot reload that changes a field's default, in a headless scene view (engine ask E25):
 * the document's omitted fields follow the new default, the fields it sets and the overrides it
 * holds do not, a prefab instance nested in another keeps its own overrides, and nothing is rebuilt
 * when no default changed or no document is open. The browser suite runs the same on a canvas.
 */

/** A type the host has never seen, for a hot reload that registers it. */
class Shade extends Component.define({ opacity: f32(1) }) {
  static typeId = "game/Shade";
}

let host: EditorHost | null = null;
let peer: EditorPeer | null = null;
let pump: ReturnType<typeof setInterval> | null = null;

afterEach(() => {
  if (pump !== null) {
    clearInterval(pump);
  }
  peer?.close();
  host?.dispose();
  host = null;
  peer = null;
  pump = null;
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
 * The street, with a second lamp post under the first whose bulb the document overrides.
 *
 * @param hash - The prefab's hash.
 * @returns The scene file.
 */
function nestedStreet(hash: string): SceneFile {
  const street = level(hash);
  return {
    ...street,
    entities: [
      ...street.entities,
      {
        uid: "INNER-POST",
        name: "Inner Post",
        parent: "STREET-POST",
        transform: { position: [0, 0, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        instance: {
          scene: { $asset: PREFAB },
          hash,
          overrides: [{ path: "BULB/components/BULB-LAMP/props/brightness", value: 9 }],
        },
      },
    ],
  };
}

/**
 * Starts a headless host, optionally with the street open.
 *
 * @param open - The file to open, or `null` for none.
 * @returns The running host.
 */
async function sceneView(open: ((hash: string) => SceneFile) | null): Promise<EditorHost> {
  const files = new Map([[PREFAB, stringifySceneFile(LAMP_POST)]]);
  const fetch: FetchLike = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = files.get(url.replace(/^.*?assets\//u, "").replace(/^\//u, ""));
    return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : new Response(body));
  };
  const target = new EventTarget();
  const starting = startEditorHost({
    editorOrigin: EDITOR_ORIGIN,
    headless: true,
    messageTarget: target,
    heartbeatIntervalMs: 60_000,
    assets: { fetch },
    scripts: [Lamp],
  });
  peer = connect(target);
  await peer.hello();
  host = await starting;
  const running = host;
  // A headless app pumps no frames, and after `start()` asset loads settle in `PreUpdate`.
  pump = setInterval(() => {
    running.app.step(1 / 60);
  }, 1);
  await peer.nextNotification(SceneNotification.schemasChanged);
  if (open !== null) {
    await call("openScene", { file: open(await computeSceneHash(LAMP_POST)), address: "scenes/street.scene.json" });
  }
  return running;
}

/**
 * The `brightness` a live lamp holds.
 *
 * @param running - The host.
 * @param uid - The component's uid, or the name of a prefab member.
 * @param post - The instance root the member is under.
 * @returns The value.
 */
function brightness(running: EditorHost, uid: string, post = "STREET-POST"): unknown {
  const world = running.app.world;
  return brightnessIn(
    world.scenes.flatMap((scene) => scene.roots),
    world.getEntity(post),
    uid,
  );
}

/**
 * Hot-reloads classes, waits for `schemasChanged`, and lets the host finish.
 *
 * @param running - The host.
 * @param types - The new classes.
 */
async function reload(running: EditorHost, types: readonly ConcreteComponentType[]): Promise<void> {
  running.app.hotReload.apply([{ types }]);
  await peer?.nextNotification(SceneNotification.schemasChanged);
  // Requests queue behind the host's work on the new defaults.
  await call("getSchemas");
}

describe("changed defaults after a script's hot reload, headless (E25)", () => {
  it("follows the document's omitted fields, and keeps what it sets and overrides", async () => {
    const running = await sceneView(nestedStreet);
    await call("applyOps", {
      commandId: "c1",
      commandName: "Edit lamps",
      ops: [
        { op: "addComponent", entity: "SETS", component: { uid: "ADDED-LAMP", type: "game/Lamp" } },
        { op: "setProp", component: "SIGN-LAMP", path: [], value: { brightness: 2 } },
      ],
    });
    const outer = running.app.world.getEntity("STREET-POST");

    await reload(running, [LampBrighter]);

    expect(brightness(running, "OMITS-LAMP")).toBe(4);
    expect(brightness(running, "SETS-LAMP")).toBe(1);
    expect(brightness(running, "ADDED-LAMP")).toBe(4);
    expect(brightness(running, "SIGN-LAMP")).toBe(2);
    expect(running.app.world.getEntity("STREET-POST")).not.toBe(outer);
    expect(brightness(running, "Lamp Post")).toBe(4);
    expect(brightness(running, "Bulb")).toBe(3);
    expect(brightness(running, "Spare")).toBe(7);
    // The inner post is rebuilt with the outer one, with its own overrides.
    expect(brightness(running, "Inner Post", "INNER-POST")).toBe(4);
    expect(brightness(running, "Bulb", "INNER-POST")).toBe(9);
    expect(brightness(running, "Spare", "INNER-POST")).toBe(4);
    expect(await call("readBack", { entities: ["INNER-POST"] })).toMatchObject({
      entities: [
        {
          uid: "INNER-POST",
          parent: "STREET-POST",
          instance: { overrides: [{ path: "BULB/components/BULB-LAMP/props/brightness", value: 9 }] },
        },
      ],
    });
  });

  it("rebuilds nothing when no default changed, for a new type, or with no document open", async () => {
    const running = await sceneView(level);
    const post = running.app.world.getEntity("STREET-POST");

    class LampAgain extends Component.define({ brightness: f32(1), radius: f32(2) }) {
      static typeId = "game/Lamp";
    }
    await reload(running, [LampAgain, Shade]);
    expect(running.app.world.getEntity("STREET-POST")).toBe(post);

    await call("closeScene");
    await reload(running, [LampBrighter]);
    expect(running.app.world.getEntity("STREET-POST")).toBeNull();
  });
});
