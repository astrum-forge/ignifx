import { Component, componentRef, computeSceneHash, entityRef, stringifySceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { SceneNotification } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import { brightnessIn, Lamp, LAMP_POST, level, PREFAB } from "./support/lamps.js";
import type { EditorHost } from "../src/host.js";
import type { EditorPeer } from "./support/editor.js";
import type { LogParams } from "../src/protocol/index.js";
import type { Entity, FetchLike, SceneFile, SceneFileEntity, SceneFileOverride } from "@ignifx/core";

/**
 * Rebuilding a prefab instance in a headless scene view, from the override list the document
 * holds: after the prefab changes on disk (engine ask E23), and for `setOverride`, whose `index` is
 * relative to the document's order. A build problem met on the way (a stale override, a reference
 * that does not resolve) reaches the editor as a `log` warning, as a reopen's would.
 */

/** The document's address. */
const STREET = "scenes/street.scene.json";

/** An override equal to the prefab's own value, which the serializer's diff leaves out. */
const BULB_AS_PREFAB: SceneFileOverride = { path: "BULB/components/BULB-LAMP/props/brightness", value: 3 };

/** The level's own override of the spare lamp. */
const SPARE_7: SceneFileOverride = { path: "SPARE/components/SPARE-LAMP/props/brightness", value: 7 };

/**
 * The warning a stale override is, as `world.loadSceneFile` writes it for the document (whose
 * address the engine's message repeats).
 *
 * @param path - The override's path.
 * @returns The log line.
 */
function staleOverride(path: string): string {
  return `IGX-0604: ${STREET}: ${STREET}: the override path "${path}" names no entity of the instanced scene.`;
}

/** A component that points at another entity. */
class Follow extends Component.define({ target: entityRef<Entity>() }) {
  static typeId = "game/Follow";
}

/** A component that points at another component. */
class Watch extends Component.define({ target: componentRef(Follow) }) {
  static typeId = "game/Watch";
}

/**
 * A `createEntity` op for a root entity whose `Follow` points at another entity.
 *
 * @param uid - The new entity's uid.
 * @param target - The uid its `Follow` points at.
 * @returns The op.
 */
function follower(uid: string, target: string): unknown {
  return {
    op: "createEntity",
    entity: {
      uid,
      name: uid,
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: `${uid}-FOLLOW`, type: "game/Follow", props: { target: { $entity: target } } }],
    },
  };
}

/** The project's files on disk, by address; a test edits them. */
const files = new Map<string, string>();

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
 * The street, with the lamp post's override list replaced.
 *
 * @param overrides - The post's whole list, in the document's order.
 * @returns The scene file for a prefab hash.
 */
function streetWith(overrides: readonly SceneFileOverride[]): (hash: string) => SceneFile {
  return (hash) => {
    const street = level(hash);
    const entities = [...street.entities];
    const at = entities.findIndex((record) => record.uid === "STREET-POST");
    const post = entities[at];
    if (post?.instance === undefined) {
      throw new Error("The street has no lamp post instance.");
    }
    entities[at] = { ...post, instance: { ...post.instance, overrides } };
    return { ...street, entities };
  };
}

/**
 * The lamp post prefab, edited.
 *
 * @param bulb - The bulb's `brightness`.
 * @param spare - Whether the spare is still there.
 * @returns The prefab file.
 */
function lampPost(bulb: number, spare: boolean): SceneFile {
  const entities = LAMP_POST.entities.filter((record) => spare || record.uid !== "SPARE");
  const at = entities.findIndex((record) => record.uid === "BULB");
  const record = entities[at];
  if (record === undefined) {
    throw new Error("The lamp post has no bulb.");
  }
  entities[at] = { ...record, components: [{ uid: "BULB-LAMP", type: "game/Lamp", props: { brightness: bulb } }] };
  return { ...LAMP_POST, entities };
}

/**
 * Starts a headless host with the street open, and collects the `log` warnings it sends.
 *
 * @param open - The street for a prefab hash.
 * @param prefab - The lamp post prefab on disk.
 * @returns The running host and the warnings, in order.
 */
async function sceneView(
  open: (hash: string) => SceneFile,
  prefab: SceneFile = LAMP_POST,
): Promise<{ running: EditorHost; warnings: string[] }> {
  files.set(PREFAB, stringifySceneFile(prefab));
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
    scripts: [Lamp, Follow, Watch],
  });
  const editor = connect(target);
  peer = editor;
  const warnings: string[] = [];
  // `request` drops the notifications it reads past, so the warnings are taken off the port itself.
  editor.port.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { method?: unknown; params?: LogParams };
    if (message.method === SceneNotification.log && message.params?.level === "warn") {
      warnings.push(message.params.message);
    }
  });
  await editor.hello();
  host = await starting;
  const running = host;
  // A headless app pumps no frames, and after `start()` asset loads settle in `PreUpdate`.
  pump = setInterval(() => {
    running.app.step(1 / 60);
  }, 1);
  await editor.nextNotification(SceneNotification.schemasChanged);
  await call("openScene", { file: open(await computeSceneHash(prefab)), address: STREET });
  return { running, warnings };
}

/**
 * The `brightness` a lamp under the street's lamp post holds.
 *
 * @param running - The host.
 * @param member - The prefab member's name.
 * @returns The value.
 */
function brightness(running: EditorHost, member: string): unknown {
  const world = running.app.world;
  return brightnessIn(
    world.scenes.flatMap((scene) => scene.roots),
    world.getEntity("STREET-POST"),
    member,
  );
}

/**
 * Tells the host the prefab changed on disk and waits for `assetReloaded`.
 *
 * @param running - The host.
 * @param prefab - The prefab's new content.
 * @returns The notification's parameters.
 */
async function editPrefab(running: EditorHost, prefab: SceneFile): Promise<unknown> {
  files.set(PREFAB, stringifySceneFile(prefab));
  const reloaded = running.assetChanged({ address: PREFAB, kind: "changed" });
  const notification = await peer?.nextNotification(SceneNotification.assetReloaded);
  expect(await reloaded).toBe(true);
  return notification?.["params"];
}

/**
 * The lamp post's override list as `readBack` writes it.
 *
 * @returns The list, and the hash it was recorded against.
 */
async function postInstance(): Promise<unknown> {
  const read = (await call("readBack", { entities: ["STREET-POST"] })) as {
    entities: readonly { instance?: unknown }[];
  };
  return read.entities[0]?.instance;
}

describe("an asset reload of a prefab, headless (E23)", () => {
  it("rebuilds the instance from the document's override list, at the new prefab", async () => {
    // The bulb's override equals the prefab's value, so a list the serializer recomputes would
    // drop it and the bulb would follow the edited prefab.
    const { running, warnings } = await sceneView(streetWith([BULB_AS_PREFAB, SPARE_7]));
    const before = running.app.world.getEntity("STREET-POST");
    const edited = lampPost(6, true);

    expect(await editPrefab(running, edited)).toEqual({ address: PREFAB, type: "scene", entities: ["STREET-POST"] });

    const after = running.app.world.getEntity("STREET-POST");
    expect(after).not.toBe(before);
    expect(before?.isDestroyed).toBe(true);
    expect(brightness(running, "Bulb")).toBe(3);
    expect(brightness(running, "Spare")).toBe(7);
    expect(brightness(running, "Lamp Post")).toBe(1);
    expect(running.app.world.getEntity("SIGN")?.parent).toBe(after);
    expect(await postInstance()).toEqual({
      scene: { $asset: PREFAB },
      hash: await computeSceneHash(edited),
      overrides: [BULB_AS_PREFAB, SPARE_7],
    });
    expect(warnings).toEqual([]);
  });

  it("reports an override the edited prefab no longer has as a warning, and still rebuilds", async () => {
    const { running, warnings } = await sceneView(streetWith([BULB_AS_PREFAB, SPARE_7]));

    expect(await editPrefab(running, lampPost(6, false))).toEqual({
      address: PREFAB,
      type: "scene",
      entities: ["STREET-POST"],
    });

    expect(brightness(running, "Bulb")).toBe(3);
    expect(warnings).toEqual([staleOverride(SPARE_7.path)]);
    // The document keeps the stale override; the editor decides what to do with it.
    expect(await postInstance()).toMatchObject({ overrides: [BULB_AS_PREFAB, SPARE_7] });
  });
});

describe("setOverride's index, headless", () => {
  it("is relative to the document's override list, not the serializer's", async () => {
    // The serializer would read this list as [SPARE_7] alone: the bulb's override equals the prefab.
    const { running, warnings } = await sceneView(streetWith([BULB_AS_PREFAB, SPARE_7]));
    const post: SceneFileOverride = { path: "POST/components/POST-LAMP/props/brightness", value: 5 };
    const spare: SceneFileOverride = { ...SPARE_7, value: 8 };

    const answer = await call("applyOps", {
      commandId: "c1",
      commandName: "Brighter post",
      ops: [
        // Between the bulb's and the spare's: index 1 of [bulb, spare].
        { op: "setOverride", entity: "STREET-POST", override: post, index: 1 },
        // The spare's override is now at index 2 of [bulb, post, spare]; replaced in place.
        { op: "setOverride", entity: "STREET-POST", override: spare, index: 2 },
        // Not at index 0, where the serializer's list would hold it.
        { op: "setOverride", entity: "STREET-POST", override: { ...SPARE_7, value: 9 }, index: 0 },
      ],
    });

    expect(answer).toMatchObject({
      applied: 2,
      failures: [{ index: 2, code: "invalidIndex", message: "The override already exists at index 2." }],
    });
    expect(await postInstance()).toMatchObject({ overrides: [BULB_AS_PREFAB, post, spare] });
    expect(brightness(running, "Lamp Post")).toBe(5);
    expect(brightness(running, "Bulb")).toBe(3);
    expect(brightness(running, "Spare")).toBe(8);
    expect(warnings).toEqual([
      expect.stringMatching(/^applyOps c1 \(Brighter post\): op 2 \(setOverride\) failed: invalidIndex/u),
    ]);
  });
});

describe("build problems of an op's subtree, headless", () => {
  it("reports an override that names no member as a warning, as a reopen does, and applies the op", async () => {
    const { warnings } = await sceneView(level);
    const stale: SceneFileOverride = { path: "GONE/components/GONE-LAMP/props/brightness", value: 2 };

    const answer = await call("applyOps", {
      commandId: "c1",
      commandName: "Stale override",
      ops: [{ op: "setOverride", entity: "STREET-POST", override: stale }],
    });

    expect(answer).toEqual({ applied: 1, failures: [] });
    expect(warnings).toEqual([staleOverride(stale.path)]);

    // The editor reopens the document with the override: the same line.
    await call("openScene", { file: streetWith([SPARE_7, stale])(await computeSceneHash(LAMP_POST)), address: STREET });
    expect(warnings).toEqual([staleOverride(stale.path), staleOverride(stale.path)]);
  });

  it("reports a reference that resolves nowhere in the document, and not one into the rest of it", async () => {
    const { running, warnings } = await sceneView(level);
    const answer = await call("applyOps", {
      commandId: "c1",
      commandName: "Followers",
      ops: [follower("TO-OMITS", "OMITS"), follower("TO-NOWHERE", "NOWHERE")],
    });

    expect(answer).toEqual({ applied: 2, failures: [] });
    expect(running.app.world.getEntity("TO-OMITS")?.getComponent(Follow)?.target).toBe(
      running.app.world.getEntity("OMITS"),
    );
    expect(warnings).toEqual([
      expect.stringMatching(/^IGX-0602: scenes\/street\.scene\.json: TO-NOWHERE-FOLLOW\.target: /u),
    ]);
  });
});

/**
 * An `add` override that gives a lamp post's root a `Follow` pointing at a document entity.
 *
 * @param target - The uid the `Follow` points at.
 * @param uid - The added component's uid.
 * @returns The override.
 */
function addFollow(target: string, uid = "ADDED-FOLLOW"): SceneFileOverride {
  return {
    path: "POST/components",
    op: "add",
    value: { uid, type: "game/Follow", props: { target: { $entity: target } } },
  };
}

/**
 * The lamp post prefab with a `Follow` on the bulb, which the prefab leaves pointing at nothing.
 *
 * @returns The prefab file.
 */
function bulbFollows(): SceneFile {
  const entities = [...LAMP_POST.entities];
  const at = entities.findIndex((record) => record.uid === "BULB");
  const bulb = entities[at];
  if (bulb === undefined) {
    throw new Error("The lamp post has no bulb.");
  }
  entities[at] = { ...bulb, components: [...(bulb.components ?? []), { uid: "BULB-FOLLOW", type: "game/Follow" }] };
  return { ...LAMP_POST, entities };
}

/** A document entity outside the lamp post whose `Watch` points at the added `Follow`. */
const WATCHER: SceneFileEntity = {
  uid: "WATCHER",
  name: "Watcher",
  parent: null,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  components: [{ uid: "WATCHER-WATCH", type: "game/Watch", props: { target: { $component: "ADDED-FOLLOW" } } }],
};

/**
 * The live `Follow` of a lamp post member.
 *
 * @param running - The host.
 * @param member - The member's name.
 * @returns The component, or `undefined`.
 */
function followOf(running: EditorHost, member: string): Follow | undefined {
  const post = running.app.world.getEntity("STREET-POST");
  const entity = [post, ...(post?.children ?? [])].find((candidate) => candidate?.name === member);
  return entity?.getComponent(Follow) ?? undefined;
}

/**
 * Applies one op and expects it to succeed.
 *
 * @param op - The op.
 */
async function applyOne(op: unknown): Promise<void> {
  expect(await call("applyOps", { commandId: "c1", commandName: "Edit", ops: [op] })).toEqual({
    applied: 1,
    failures: [],
  });
}

describe("references an instance's overrides hold, through a rebuild, headless", () => {
  it("keeps an added component's reference to the rest of the document, as a reopen does", async () => {
    const { running, warnings } = await sceneView(streetWith([SPARE_7, addFollow("OMITS")]));
    const omits = running.app.world.getEntity("OMITS");
    expect(followOf(running, "Lamp Post")?.target).toBe(omits);

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: BULB_AS_PREFAB });
    expect(followOf(running, "Lamp Post")?.target).toBe(omits);
    await applyOne({ op: "removeOverride", entity: "STREET-POST", path: SPARE_7.path });
    expect(followOf(running, "Lamp Post")?.target).toBe(omits);
    await editPrefab(running, lampPost(6, true));
    expect(followOf(running, "Lamp Post")?.target).toBe(omits);

    // Added once, not also as the root's own component, which the serializer writes it as.
    expect(running.app.world.getEntity("STREET-POST")?.getComponents(Follow)).toHaveLength(1);
    const read = (await call("readBack", { entities: ["STREET-POST"] })) as { entities: readonly unknown[] };
    expect(read.entities[0]).not.toHaveProperty("components");
    expect(await postInstance()).toMatchObject({ overrides: [addFollow("OMITS"), BULB_AS_PREFAB] });
    expect(warnings).toEqual([]);
  });

  it("keeps a member's overridden reference to the rest of the document", async () => {
    const aim: SceneFileOverride = { path: "BULB/components/BULB-FOLLOW/props/target", value: { $entity: "OMITS" } };
    const { running, warnings } = await sceneView(streetWith([aim]), bulbFollows());
    const omits = running.app.world.getEntity("OMITS");
    expect(followOf(running, "Bulb")?.target).toBe(omits);

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: SPARE_7 });

    expect(followOf(running, "Bulb")?.target).toBe(omits);
    expect(warnings).toEqual([]);
  });

  it("still reports an overridden reference that resolves nowhere, once a build, as a reopen does", async () => {
    const { running, warnings } = await sceneView(streetWith([addFollow("NOWHERE")]));
    const line = 'IGX-0602: scenes/street.scene.json: ADDED-FOLLOW.target: no target in this file has uid "NOWHERE".';
    expect(warnings).toEqual([line]);

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: SPARE_7 });

    expect(followOf(running, "Lamp Post")?.target).toBeNull();
    expect(warnings).toEqual([line, line]);
  });

  it("re-points a reference from the rest of the document to an added component", async () => {
    const add = addFollow("OMITS");
    const { running, warnings } = await sceneView((hash) => {
      const street = streetWith([add])(hash);
      return { ...street, entities: [...street.entities, WATCHER] };
    });
    const watch = (): Watch | null | undefined => running.app.world.getEntity("WATCHER")?.getComponent(Watch);
    expect(watch()?.target).toBe(followOf(running, "Lamp Post"));

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: SPARE_7 });
    const added = followOf(running, "Lamp Post");
    expect(added?.isDestroyed).toBe(false);
    expect(watch()?.target).toBe(added);
    expect(warnings).toEqual([]);

    expect(running.app.world.getEntity("STREET-POST")?.getComponents(Follow)).toHaveLength(1);

    // Without the component the reference resolves nowhere, which a reopen would report.
    await applyOne({ op: "removeOverride", entity: "STREET-POST", path: add.path, added: "ADDED-FOLLOW" });
    expect(watch()?.target).toBeNull();
    expect(warnings).toEqual([
      'IGX-0602: scenes/street.scene.json: WATCHER-WATCH.target: no target in this file has uid "ADDED-FOLLOW".',
    ]);
  });

  it("re-points another instance's added component that points into the rebuilt one", async () => {
    const { running, warnings } = await sceneView((hash) => {
      const street = level(hash);
      const second: SceneFileEntity = {
        uid: "SECOND-POST",
        name: "Second Post",
        parent: null,
        transform: { position: [8, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        instance: { scene: { $asset: PREFAB }, hash, overrides: [addFollow("SIGN", "SECOND-FOLLOW")] },
      };
      return { ...street, entities: [...street.entities, second] };
    });
    const follow = (): Follow | null | undefined => running.app.world.getEntity("SECOND-POST")?.getComponent(Follow);
    expect(follow()?.target).toBe(running.app.world.getEntity("SIGN"));

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: BULB_AS_PREFAB });

    const sign = running.app.world.getEntity("SIGN");
    expect(sign?.isDestroyed).toBe(false);
    expect(follow()?.target).toBe(sign);
    expect(warnings).toEqual([]);
  });
});
