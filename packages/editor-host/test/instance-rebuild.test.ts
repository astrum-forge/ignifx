import {
  array,
  Component,
  componentRef,
  computeSceneHash,
  entityRef,
  map,
  optional,
  record as recordOf,
  Script,
  stringifySceneFile,
} from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { SceneNotification } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import { brightnessIn, Lamp, LAMP_POST, level, PREFAB } from "./support/lamps.js";
import type { EditorHost } from "../src/host.js";
import type { EditorPeer } from "./support/editor.js";
import type { LogParams } from "../src/protocol/index.js";
import type {
  ComponentType,
  Entity,
  FetchLike,
  SceneFile,
  SceneFileComponent,
  SceneFileEntity,
  SceneFileOverride,
} from "@ignifx/core";

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

/** A component that points at another entity, and at a second one. */
class Follow extends Component.define({ target: entityRef<Entity>(), also: entityRef<Entity>() }) {
  static typeId = "game/Follow";
}

/** A component that points at another component. */
class Watch extends Component.define({ target: componentRef(Follow) }) {
  static typeId = "game/Watch";
}

/** A component that points at several entities, in every kind of field that can hold one. */
class Crowd extends Component.define({
  members: array(entityRef<Entity>()),
  named: map(entityRef<Entity>()),
  pair: recordOf({ first: entityRef<Entity>() }),
  maybe: optional(entityRef<Entity>()),
}) {
  static typeId = "game/Crowd";
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
 * @returns The running host, the `log` warnings in order, and `openScene`'s result.
 */
async function sceneView(
  open: (hash: string) => SceneFile,
  prefab: SceneFile = LAMP_POST,
): Promise<{ running: EditorHost; warnings: string[]; opened: unknown }> {
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
    scripts: [Lamp, Follow, Watch, Crowd],
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
  const opened = await call("openScene", { file: open(await computeSceneHash(prefab)), address: STREET });
  return { running, warnings, opened };
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
  components: [
    {
      uid: "WATCHER-WATCH",
      type: "game/Watch",
      props: { target: { $component: "ADDED-FOLLOW" } },
    },
  ],
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
    expect(running.app.world.getEntity("STREET-POST")?.getComponents(Follow)).toHaveLength(1);
    expect(warnings).toEqual([]);

    // Without the component the reference resolves nowhere, which a reopen would report.
    await applyOne({ op: "removeOverride", entity: "STREET-POST", path: add.path, added: "ADDED-FOLLOW" });
    expect(watch()?.target).toBeNull();
    expect(warnings).toEqual([
      'IGX-0602: scenes/street.scene.json: WATCHER-WATCH.target: no target in this file has uid "ADDED-FOLLOW".',
    ]);
  });

  it("re-points a component another instance adds to a member, which points into the rebuilt one", async () => {
    const add: SceneFileOverride = {
      path: "BULB/components",
      op: "add",
      value: {
        uid: "SECOND-FOLLOW",
        type: "game/Follow",
        props: { target: { $entity: "SIGN" }, also: { $entity: "NOWHERE" } },
      },
    };
    const { running, warnings } = await sceneView((hash) => {
      const street = level(hash);
      const second: SceneFileEntity = {
        uid: "SECOND-POST",
        name: "Second Post",
        parent: null,
        transform: { position: [8, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        instance: { scene: { $asset: PREFAB }, hash, overrides: [add] },
      };
      return { ...street, entities: [...street.entities, second] };
    });
    const follow = (): Follow | null | undefined =>
      running.app.world
        .getEntity("SECOND-POST")
        ?.children.find((member) => member.name === "Bulb")
        ?.getComponent(Follow);
    expect(follow()?.target).toBe(running.app.world.getEntity("SIGN"));
    const nowhere = 'IGX-0602: scenes/street.scene.json: SECOND-FOLLOW.also: no target in this file has uid "NOWHERE".';
    expect(warnings).toEqual([nowhere]);

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: BULB_AS_PREFAB });

    const sign = running.app.world.getEntity("SIGN");
    expect(sign?.isDestroyed).toBe(false);
    expect(follow()?.target).toBe(sign);
    // Only the field that points in is decoded again: `also` was reported when it was built.
    expect(warnings).toEqual([nowhere]);
  });
});

describe("a file in the old form readBack wrote for a root's added component, headless", () => {
  it("opens with the component once, warns once, and reads back the same before and after a rebuild", async () => {
    // Before #98 `readBack` wrote an `add` on the root of a one-root prefab twice: in the override
    // list and as the root's own component, with the same uid.
    const own: SceneFileComponent = {
      uid: "ADDED-FOLLOW",
      type: "game/Follow",
      props: { target: { $entity: "OMITS" } },
    };
    const { running, warnings, opened } = await sceneView((hash) => {
      const street = streetWith([addFollow("OMITS")])(hash);
      const entities = street.entities.map((record) =>
        record.uid === "STREET-POST" ? { ...record, components: [own] } : record,
      );
      return { ...street, entities };
    });
    const post = running.app.world.getEntity("STREET-POST");
    expect(post?.getComponents(Follow)).toHaveLength(1);
    expect(followOf(running, "Lamp Post")?.target).toBe(running.app.world.getEntity("OMITS"));
    expect((opened as { warnings: unknown }).warnings).toEqual([
      {
        code: "IGX-0608",
        message:
          `${STREET}: STREET-POST/ADDED-FOLLOW: an older editor wrote each of these components both as an ` +
          "instance root's own and in its override list, with one uid; each is kept once, as the list adds it.",
      },
    ]);
    const read = async (): Promise<unknown> => call("readBack", { entities: ["STREET-POST"] });
    const before = await read();
    expect((before as { entities: readonly unknown[] }).entities[0]).not.toHaveProperty("components");

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: SPARE_7 });
    await applyOne({ op: "removeOverride", entity: "STREET-POST", path: SPARE_7.path });

    expect(await read()).toEqual(before);
    expect(running.app.world.getEntity("STREET-POST")?.getComponents(Follow)).toHaveLength(1);
    expect(warnings).toEqual([]);
  });
});

/**
 * The lamp post prefab with a `Follow`, a `Watch` and a `Crowd` on the bulb, which an instance's
 * overrides aim; only the `Crowd` points somewhere, at the spare of its own lamp post.
 *
 * @returns The prefab file.
 */
function bulbAims(): SceneFile {
  const prefab = bulbFollows();
  const entities = [...prefab.entities];
  const at = entities.findIndex((record) => record.uid === "BULB");
  const bulb = entities[at];
  if (bulb === undefined) {
    throw new Error("The lamp post has no bulb.");
  }
  const aimed = [
    { uid: "BULB-WATCH", type: "game/Watch" },
    {
      uid: "BULB-CROWD",
      type: "game/Crowd",
      props: { members: [{ $entity: "SPARE" }, null], named: { own: { $entity: "SPARE" } } },
    },
  ];
  entities[at] = { ...bulb, components: [...(bulb.components ?? []), ...aimed] };
  return { ...prefab, entities };
}

/**
 * The overrides that aim every field of an instance's bulb `Crowd` at the street's sign, and its
 * list at the lamp that omits its brightness too.
 */
const AIM_CROWD: readonly SceneFileOverride[] = [
  { path: "BULB/components/BULB-CROWD/props/members", value: [{ $entity: "SIGN" }, { $entity: "OMITS" }] },
  { path: "BULB/components/BULB-CROWD/props/named", value: { sign: { $entity: "SIGN" } } },
  { path: "BULB/components/BULB-CROWD/props/pair", value: { first: { $entity: "SIGN" } } },
  { path: "BULB/components/BULB-CROWD/props/maybe", value: { $entity: "SIGN" } },
];

/**
 * An override that aims an instance's bulb `Follow` at a document entity.
 *
 * @param target - The entity's uid.
 * @returns The override.
 */
function aimFollow(target: string): SceneFileOverride {
  return { path: "BULB/components/BULB-FOLLOW/props/target", value: { $entity: target } };
}

/**
 * An override that aims an instance's bulb `Watch` at a component.
 *
 * @param target - The component's uid.
 * @returns The override.
 */
function aimWatch(target: string): SceneFileOverride {
  return { path: "BULB/components/BULB-WATCH/props/target", value: { $component: target } };
}

/**
 * The street with a second lamp post after the first, which has a sign of its own.
 *
 * @param first - The first post's override list.
 * @param second - The second post's override list.
 * @returns The scene file for a prefab hash.
 */
function twoPosts(
  first: readonly SceneFileOverride[],
  second: readonly SceneFileOverride[],
): (hash: string) => SceneFile {
  return (hash) => {
    const street = streetWith(first)(hash);
    const at = { rotation: [0, 0, 0, 1], scale: [1, 1, 1] } as const;
    const records: SceneFileEntity[] = [
      {
        uid: "SECOND-POST",
        name: "Second Post",
        parent: null,
        transform: { position: [8, 0, 0], ...at },
        instance: { scene: { $asset: PREFAB }, hash, overrides: [...second] },
      },
      { uid: "SECOND-SIGN", name: "Second Sign", parent: "SECOND-POST", transform: { position: [0, 3, 0], ...at } },
    ];
    return { ...street, entities: [...street.entities, ...records] };
  };
}

/**
 * A component of a lamp post's bulb.
 *
 * @param running - The host.
 * @param post - The post's uid.
 * @param type - The component's class.
 * @returns The live component, or `undefined`.
 */
function bulbOf<T extends Component>(running: EditorHost, post: string, type: ComponentType<T>): T | undefined {
  const bulb = running.app.world.getEntity(post)?.children.find((member) => member.name === "Bulb");
  return bulb?.getComponent(type) ?? undefined;
}

/**
 * An instance root's override list as `readBack` writes it.
 *
 * @param uid - The root.
 * @returns The list.
 */
async function overridesOf(uid: string): Promise<unknown> {
  const read = (await call("readBack", { entities: [uid] })) as {
    entities: readonly { instance?: { overrides?: unknown } }[];
  };
  return read.entities[0]?.instance?.overrides;
}

describe("another instance's member overrides that point into a rebuilt instance, headless", () => {
  it("re-points them to the rebuilt entities and components, and reads back the document's list", async () => {
    const second = [aimFollow("SIGN"), aimWatch("ADDED-FOLLOW"), ...AIM_CROWD];
    const { running, warnings } = await sceneView(twoPosts([addFollow("OMITS")], second), bulbAims());
    const world = running.app.world;
    expect(bulbOf(running, "SECOND-POST", Follow)?.target).toBe(world.getEntity("SIGN"));
    expect(bulbOf(running, "SECOND-POST", Watch)?.target).toBe(followOf(running, "Lamp Post"));

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: SPARE_7 });

    const sign = world.getEntity("SIGN");
    const added = followOf(running, "Lamp Post");
    expect(sign?.isDestroyed).toBe(false);
    expect(added?.isDestroyed).toBe(false);
    expect(bulbOf(running, "SECOND-POST", Follow)?.target).toBe(sign);
    expect(bulbOf(running, "SECOND-POST", Watch)?.target).toBe(added);
    const crowd = bulbOf(running, "SECOND-POST", Crowd);
    expect(crowd?.members).toEqual([sign, world.getEntity("OMITS")]);
    expect(crowd?.members[0]).toBe(sign);
    expect(crowd?.named["sign"]).toBe(sign);
    expect(crowd?.pair.first).toBe(sign);
    expect(crowd?.maybe).toBe(sign);
    expect(await overridesOf("SECOND-POST")).toEqual(second);
    expect(warnings).toEqual([]);
  });

  it("keeps a member's references to its own instance beside the ones it re-points", async () => {
    const second: SceneFileOverride[] = [
      { path: "BULB/components/BULB-CROWD/props/members/1", value: { $entity: "SIGN" } },
      { path: "BULB/components/BULB-CROWD/props/named/sign", value: { $entity: "SIGN" } },
    ];
    const { running, warnings } = await sceneView(twoPosts([], second), bulbAims());
    const spare = running.app.world.getEntity("SECOND-POST")?.children.find((member) => member.name === "Spare");
    expect(bulbOf(running, "SECOND-POST", Crowd)?.members[0]).toBe(spare);

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: SPARE_7 });

    const sign = running.app.world.getEntity("SIGN");
    const crowd = bulbOf(running, "SECOND-POST", Crowd);
    expect(spare?.isDestroyed).toBe(false);
    expect(crowd?.members[0]).toBe(spare);
    expect(crowd?.members[1]).toBe(sign);
    expect(crowd?.named["own"]).toBe(spare);
    expect(crowd?.named["sign"]).toBe(sign);
    expect(await overridesOf("SECOND-POST")).toEqual(second);
    expect(warnings).toEqual([]);
  });

  it("reports one that the edit left with nothing to name, as a reopen does", async () => {
    const add = addFollow("OMITS");
    const { running, warnings } = await sceneView(twoPosts([add], [aimWatch("ADDED-FOLLOW")]), bulbAims());

    await applyOne({ op: "removeOverride", entity: "STREET-POST", path: add.path, added: "ADDED-FOLLOW" });

    const watch = bulbOf(running, "SECOND-POST", Watch);
    expect(watch?.target).toBeNull();
    expect(warnings).toEqual([
      `IGX-0602: scenes/street.scene.json: ${watch?.uid ?? ""}.target: no target in this file has uid "ADDED-FOLLOW".`,
    ]);
  });

  it("keeps two instances that point into each other through a reload that rebuilds both", async () => {
    const { running, warnings } = await sceneView(
      twoPosts([aimFollow("SECOND-SIGN")], [aimFollow("SIGN")]),
      bulbAims(),
    );
    const world = running.app.world;

    expect(await editPrefab(running, bulbAims())).toEqual({
      address: PREFAB,
      type: "scene",
      entities: ["STREET-POST", "SECOND-POST"],
    });

    expect(bulbOf(running, "STREET-POST", Follow)?.target).toBe(world.getEntity("SECOND-SIGN"));
    expect(bulbOf(running, "SECOND-POST", Follow)?.target).toBe(world.getEntity("SIGN"));
    expect(world.getEntity("SIGN")?.isDestroyed).toBe(false);
    expect(world.getEntity("SECOND-SIGN")?.isDestroyed).toBe(false);
    expect(await overridesOf("STREET-POST")).toEqual([aimFollow("SECOND-SIGN")]);
    expect(await overridesOf("SECOND-POST")).toEqual([aimFollow("SIGN")]);
    expect(warnings).toEqual([]);
  });
});

describe("a held member that the rebuild itself destroys, headless", () => {
  it("is not re-pointed, so nothing is reported for it", async () => {
    const add = addFollow("OMITS");
    const { running, warnings } = await sceneView(twoPosts([add], [aimWatch("ADDED-FOLLOW")]), bulbAims());
    const held = bulbOf(running, "SECOND-POST", Watch);
    expect(held?.target).toBe(followOf(running, "Lamp Post"));
    // An edit-mode script on the rebuilt root that takes the held member down with it.
    class Saboteur extends Script {
      static typeId = "test/Saboteur";
      static runInEditMode = true;
      onDestroy(): void {
        held?.destroy();
      }
    }
    running.app.registerComponents([Saboteur]);
    running.app.world.getEntity("STREET-POST")?.addComponent(Saboteur);

    // Without the added component a live member's field would resolve nowhere and be reported.
    await applyOne({ op: "removeOverride", entity: "STREET-POST", path: add.path, added: "ADDED-FOLLOW" });

    expect(held?.isDestroyed).toBe(true);
    expect(warnings).toEqual([]);
  });
});

/**
 * Counts the reads of a component's field that the walk for held references makes, by putting an
 * accessor in place of the field.
 *
 * @param component - The component.
 * @param field - The field's name.
 * @returns The count so far.
 */
function walkReads(component: Component | undefined, field: string): () => number {
  if (component === undefined) {
    throw new Error(`No component to count the reads of ${field} on.`);
  }
  let reads = 0;
  let value: unknown = Reflect.get(component, field);
  Object.defineProperty(component, field, {
    configurable: true,
    enumerable: true,
    get: () => {
      // The serializer and the destroy read the field too; only the walk's reads count.
      if (new Error("read").stack?.includes("heldByMembers") === true) {
        reads += 1;
      }
      return value;
    },
    set: (next: unknown) => {
      value = next;
    },
  });
  return () => reads;
}

describe("the walk for references held by other instances' members, headless", () => {
  it("reads only the instances whose override lists point into the rebuilt one", async () => {
    const { running, warnings } = await sceneView((hash) => {
      const street = twoPosts([], [aimFollow("SIGN")])(hash);
      const third: SceneFileEntity = {
        uid: "THIRD-POST",
        name: "Third Post",
        parent: null,
        transform: { position: [16, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        instance: { scene: { $asset: PREFAB }, hash, overrides: [aimFollow("OMITS")] },
      };
      return { ...street, entities: [...street.entities, third] };
    }, bulbAims());
    const pointing = walkReads(bulbOf(running, "SECOND-POST", Follow), "target");
    const elsewhere = walkReads(bulbOf(running, "THIRD-POST", Follow), "target");

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: SPARE_7 });

    expect(pointing()).toBeGreaterThan(0);
    expect(elsewhere()).toBe(0);
    expect(bulbOf(running, "SECOND-POST", Follow)?.target).toBe(running.app.world.getEntity("SIGN"));
    expect(bulbOf(running, "THIRD-POST", Follow)?.target).toBe(running.app.world.getEntity("OMITS"));
    expect(warnings).toEqual([]);
  });
});

describe("a reference field that points into a rebuilt instance among others, headless", () => {
  it("reports another unresolvable reference in the same field once, when it was built", async () => {
    const add: SceneFileOverride = {
      path: "BULB/components",
      op: "add",
      value: {
        uid: "ADDED-CROWD",
        type: "game/Crowd",
        props: { members: [{ $entity: "SIGN" }, { $entity: "NOWHERE" }] },
      },
    };
    const { running, warnings } = await sceneView(twoPosts([], [add]));
    const line =
      'IGX-0602: scenes/street.scene.json: ADDED-CROWD.members[1]: no target in this file has uid "NOWHERE".';
    expect(warnings).toEqual([line]);

    await applyOne({ op: "setOverride", entity: "STREET-POST", override: BULB_AS_PREFAB });
    await applyOne({ op: "setOverride", entity: "STREET-POST", override: SPARE_7 });

    const sign = running.app.world.getEntity("SIGN");
    expect(sign?.isDestroyed).toBe(false);
    expect(bulbOf(running, "SECOND-POST", Crowd)?.members).toEqual([sign, null]);
    expect(warnings).toEqual([line]);
  });
});
