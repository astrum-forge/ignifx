import { computeSceneHash, stringifySceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { SceneNotification } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import { Lamp, LAMP_POST, level, PREFAB } from "./support/lamps.js";
import type { EditorHost } from "../src/host.js";
import type { EditorPeer } from "./support/editor.js";
import type { FetchLike, SceneFile, SceneFileOverride } from "@ignifx/core";

/**
 * An instance holds one override per identity (path, `op`, and an added component's uid), as
 * `validateSceneFile` requires: `openScene` refuses a file with two, `instantiate` and
 * `createEntity` refuse an entry with two, and `setOverride` on an identity the list holds replaces
 * it, so the document never gets a second.
 */

/** The document's address. */
const STREET = "scenes/street.scene.json";

/** The level's own override of the spare lamp. */
const SPARE_7: SceneFileOverride = { path: "SPARE/components/SPARE-LAMP/props/brightness", value: 7 };

/** A transform at the origin. */
const ORIGIN = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } as const;

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
 * Starts a headless host with the lamp post prefab on disk, and no scene open.
 *
 * @returns The editor's end of the channel, and the prefab's hash.
 */
async function startHost(): Promise<{ editor: EditorPeer; hash: string }> {
  const prefab = stringifySceneFile(LAMP_POST);
  const fetch: FetchLike = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const found = url.replace(/^.*?assets\//u, "").replace(/^\//u, "") === PREFAB;
    return Promise.resolve(found ? new Response(prefab) : new Response(null, { status: 404 }));
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
  const editor = connect(target);
  peer = editor;
  await editor.hello();
  host = await starting;
  const running = host;
  // A headless app pumps no frames, and after `start()` asset loads settle in `PreUpdate`.
  pump = setInterval(() => {
    running.app.step(1 / 60);
  }, 1);
  await editor.nextNotification(SceneNotification.schemasChanged);
  return { editor, hash: await computeSceneHash(LAMP_POST) };
}

/**
 * The street, with the lamp post's override list replaced.
 *
 * @param hash - The prefab's hash.
 * @param overrides - The post's whole list.
 * @returns The scene file.
 */
function streetWith(hash: string, overrides: readonly SceneFileOverride[]): SceneFile {
  const street = level(hash);
  const entities = [...street.entities];
  const at = entities.findIndex((record) => record.uid === "STREET-POST");
  const post = entities[at];
  if (post?.instance === undefined) {
    throw new Error("The street has no lamp post instance.");
  }
  entities[at] = { ...post, instance: { ...post.instance, overrides } };
  return { ...street, entities };
}

/**
 * Sends one request and returns its result.
 *
 * @param editor - The editor's end.
 * @param method - The method.
 * @param params - Its parameters.
 * @returns The result.
 */
async function call(editor: EditorPeer, method: string, params?: unknown): Promise<unknown> {
  const answer = await editor.request(method, params);
  if ("error" in answer) {
    throw new Error(`${method} failed: ${JSON.stringify(answer)}`);
  }
  return answer["result"];
}

describe("duplicate override identities, headless", () => {
  it("refuses to open a file whose instance holds two overrides with one identity", async () => {
    const { editor, hash } = await startHost();

    const answer = await editor.request("openScene", {
      file: streetWith(hash, [SPARE_7, { ...SPARE_7, value: 9 }]),
      address: STREET,
    });

    expect(answer).toMatchObject({
      error: {
        code: -32602,
        data: {
          issues: [
            {
              path: "entities/2/instance/overrides/1",
              message: expect.stringContaining("duplicates overrides/0") as unknown,
            },
          ],
        },
      },
    });
  });

  it("replaces the override setOverride names by identity, so readBack holds one", async () => {
    const { editor, hash } = await startHost();
    await call(editor, "openScene", { file: streetWith(hash, [SPARE_7]), address: STREET });

    const answer = await call(editor, "applyOps", {
      commandId: "c1",
      commandName: "Brighter spare",
      ops: [
        { op: "setOverride", entity: "STREET-POST", override: { ...SPARE_7, value: 8 } },
        { op: "setOverride", entity: "STREET-POST", override: { ...SPARE_7, value: 9 } },
      ],
    });
    const read = (await call(editor, "readBack", { entities: ["STREET-POST"] })) as {
      entities: readonly { instance?: { overrides?: unknown } }[];
    };

    expect(answer).toEqual({ applied: 2, failures: [], warnings: [] });
    expect(read.entities[0]?.instance?.overrides).toEqual([{ ...SPARE_7, value: 9 }]);
  });

  it("refuses an instantiate or createEntity whose instance entry holds two with one identity", async () => {
    const { editor, hash } = await startHost();
    await call(editor, "openScene", { file: streetWith(hash, [SPARE_7]), address: STREET });
    const instance = { scene: { $asset: PREFAB }, hash, overrides: [SPARE_7, { ...SPARE_7, value: 9 }] };

    const answer = await call(editor, "applyOps", {
      commandId: "c1",
      commandName: "Two posts",
      ops: [
        { op: "instantiate", entity: "POST-2", name: "Post 2", parent: null, transform: ORIGIN, instance },
        { op: "createEntity", entity: { uid: "POST-3", name: "Post 3", parent: null, transform: ORIGIN, instance } },
      ],
    });
    const read = (await call(editor, "readBack", {})) as { entities: readonly { uid: string }[] };

    const failure = {
      code: "invalidValue",
      message: expect.stringMatching(/^entities\/0\/instance\/overrides\/1: duplicates overrides\/0/u) as unknown,
      diagnostic: "IGX-0608",
    };
    expect(answer).toMatchObject({
      applied: 0,
      failures: [
        { index: 0, ...failure },
        { index: 1, ...failure },
      ],
    });
    expect(read.entities.map((record) => record.uid)).not.toContain("POST-2");
    expect(read.entities.map((record) => record.uid)).not.toContain("POST-3");
  });
});
