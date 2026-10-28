import { afterEach, describe, expect, it } from "vitest";
import { ApplyOpFailureCode, SceneNotification } from "../src/protocol/index.js";
import { CRATE_PREFAB, PAIR_PREFAB, startLiveHost } from "./support/scene-project.js";
import type { Received } from "./support/editor.js";
import type { LiveHost, Wire } from "./support/scene-project.js";
import type { SceneOp } from "../src/protocol/index.js";
import type { App, SceneFile, SceneFileEntity } from "@ignifx/core";

/**
 * `applyOps` op by op: each op changes the live world so that `readBack` reflects it, and an op the
 * world disagrees with fails with editor-core's code (`docs/protocol.md` in the editor repository,
 * "What the host must do").
 */

/** A transform at a position. */
const at = (x: number, y = 0, z = 0): SceneFileEntity["transform"] => ({
  position: [x, y, z],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

/** The scene every test opens: two roots, a child, and a prefab instance. */
const FILE: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "ops",
  entities: [
    {
      uid: "A",
      name: "A",
      parent: null,
      transform: at(1),
      components: [{ uid: "A-H", type: "game/Health", props: { max: 10, regenPerSecond: 0 } }],
    },
    {
      uid: "B",
      name: "B",
      parent: null,
      transform: at(2),
      components: [{ uid: "B-F", type: "game/Follow", props: { target: { $entity: "P" } } }],
    },
    { uid: "C", name: "C", parent: "A", transform: at(0, 1) },
    {
      uid: "P",
      name: "Crate",
      parent: null,
      transform: at(5),
      instance: { scene: { $asset: "prefabs/crate.prefab.json" } },
    },
  ],
};

let live: LiveHost | null = null;
let next = 100;

afterEach(async () => {
  await live?.dispose();
  live = null;
});

/**
 * Starts a host and opens {@link FILE}.
 *
 * @returns The app and the editor's end.
 */
async function opened(): Promise<{ readonly app: App; readonly peer: Wire }> {
  live = startLiveHost();
  const peer = live.wire;
  await peer.request({
    jsonrpc: "2.0",
    id: 1,
    method: "hello",
    params: { editorVersion: "0.1.0", protocol: { major: 0, minor: 3 } },
  });
  live.release();
  const host = await live.host;
  await peer.notification(SceneNotification.schemasChanged);
  const answer = await call(peer, "openScene", { file: FILE, address: "scenes/ops.scene.json" });
  expect(answer).toHaveProperty("result.entityCount", 6);
  return { app: host.app, peer };
}

/**
 * Sends one request.
 *
 * @param peer - The editor's end.
 * @param method - The method.
 * @param params - Its parameters.
 * @returns The answer.
 */
async function call(peer: Wire, method: string, params: unknown): Promise<Received> {
  next += 1;
  return peer.request({ jsonrpc: "2.0", id: next, method, params });
}

/**
 * Applies ops as one command.
 *
 * @param peer - The editor's end.
 * @param ops - The ops.
 * @returns The result.
 */
async function apply(peer: Wire, ops: readonly SceneOp[]): Promise<unknown> {
  const answer = await call(peer, "applyOps", { ops, commandName: "Test", commandId: `cmd-${String(next)}` });
  return answer["result"];
}

/**
 * Reads the whole document back.
 *
 * @param peer - The editor's end.
 * @returns The records, by uid, and their order.
 */
async function readAll(
  peer: Wire,
): Promise<{ readonly order: string[]; readonly byUid: Map<string, SceneFileEntity>; readonly settings: unknown }> {
  const answer = await call(peer, "readBack", {});
  const result = answer["result"] as { readonly entities: SceneFileEntity[]; readonly settings: unknown };
  return {
    order: result.entities.map((record) => record.uid),
    byUid: new Map(result.entities.map((record) => [record.uid, record])),
    settings: result.settings,
  };
}

/**
 * The failure codes of a result.
 *
 * @param result - An `applyOps` result.
 * @returns The codes, in order.
 */
function codes(result: unknown): string[] {
  const failures = (result as { readonly failures: readonly { readonly code: string }[] }).failures;
  return failures.map((failure) => failure.code);
}

describe("applyOps on a live world", () => {
  it("creates a subtree with its uids, components and references, at an index", async () => {
    const { peer } = await opened();
    const result = await apply(peer, [
      {
        op: "createEntity",
        entity: {
          uid: "N",
          name: "New",
          parent: "A",
          transform: at(0, 2),
          components: [
            { uid: "N-H", type: "game/Health", props: { max: 3 } },
            { uid: "N-F", type: "game/Follow", props: { target: { $entity: "B" } } },
          ],
        },
        index: 0,
        descendants: [
          { uid: "N1", name: "Leaf", parent: "N", active: false, tags: ["b", "a"], transform: at(0, 0, 1) },
        ],
      },
    ]);
    expect(result).toEqual({ applied: 1, failures: [] });
    const all = await readAll(peer);
    expect(all.order).toEqual(["A", "N", "N1", "C", "B", "P"]);
    expect(all.byUid.get("N")?.components).toEqual([
      { uid: "N-H", type: "game/Health", props: { max: 3, regenPerSecond: 0 } },
      { uid: "N-F", type: "game/Follow", props: { target: { $entity: "B" } } },
    ]);
    expect(all.byUid.get("N1")).toMatchObject({ parent: "N", active: false, tags: ["a", "b"] });
  });

  it("destroys, reparents keeping the local transform, and reorders", async () => {
    const { peer } = await opened();
    expect(
      await apply(peer, [
        { op: "reparent", entity: "B", parent: "A", index: 0 },
        { op: "reorder", entity: "P", index: 0 },
        { op: "destroyEntity", entity: "C" },
      ]),
    ).toEqual({ applied: 3, failures: [] });
    const all = await readAll(peer);
    expect(all.order).toEqual(["P", "A", "B"]);
    expect(all.byUid.get("B")).toMatchObject({ parent: "A", transform: at(2) });
  });

  it("writes entity fields and the transform", async () => {
    const { peer } = await opened();
    await apply(peer, [
      { op: "setEntityField", entity: "B", field: "name", value: "Bee" },
      { op: "setEntityField", entity: "B", field: "active", value: false },
      { op: "setEntityField", entity: "B", field: "static", value: true },
      { op: "setEntityField", entity: "B", field: "layer", value: "Characters" },
      { op: "setEntityField", entity: "B", field: "tags", value: ["y", "x"] },
      {
        op: "setTransform",
        entity: "B",
        after: { position: [1, 2, 3], rotation: [0, 0.6, 0, 0.8], scale: [2, 2, 2] },
      },
    ]);
    const record = (await readAll(peer)).byUid.get("B");
    expect(record).toMatchObject({
      uid: "B",
      name: "Bee",
      parent: null,
      active: false,
      static: true,
      layer: "Characters",
      tags: ["x", "y"],
      transform: { position: [1, 2, 3], rotation: [0, 0.6, 0, 0.8], scale: [2, 2, 2] },
    });
  });

  it("adds, edits and removes components and props", async () => {
    const { peer } = await opened();
    expect(
      await apply(peer, [
        {
          op: "addComponent",
          entity: "B",
          component: { uid: "B-H", type: "game/Health", enabled: false, props: { max: 5 } },
        },
        { op: "addComponent", entity: "B", component: { uid: "B-G", type: "game/Health" }, index: 0 },
        { op: "setProp", component: "B-H", path: ["regenPerSecond"], value: 1.5 },
        { op: "setProp", component: "A-H", path: ["max"] },
        { op: "setProp", component: "B-G", path: [], value: { max: 7 } },
        { op: "removeComponent", component: "A-H" },
      ]),
    ).toEqual({ applied: 6, failures: [] });
    const all = await readAll(peer);
    expect(all.byUid.get("B")?.components?.map((component) => component.uid)).toEqual(["B-G", "B-F", "B-H"]);
    expect(all.byUid.get("B")?.components?.[0]).toEqual({
      uid: "B-G",
      type: "game/Health",
      props: { max: 7, regenPerSecond: 0 },
    });
    expect(all.byUid.get("B")?.components?.[2]).toEqual({
      uid: "B-H",
      type: "game/Health",
      enabled: false,
      props: { max: 5, regenPerSecond: 1.5 },
    });
    expect(all.byUid.get("A")?.components).toBeUndefined();
  });

  it("writes scene settings at a path and removes them", async () => {
    const { peer } = await opened();
    await apply(peer, [
      { op: "setSceneSetting", path: ["twoD"], value: { mode: "mixed", pixelsPerUnit: 16 } },
      { op: "setSceneSetting", path: ["twoD", "pixelsPerUnit"], value: 32 },
      { op: "setSceneSetting", path: ["fog"], value: [1, 2] },
      { op: "setSceneSetting", path: ["fog", 0] },
    ]);
    expect((await readAll(peer)).settings).toEqual({ twoD: { mode: "mixed", pixelsPerUnit: 32 }, fog: [2] });
  });

  it("instantiates a prefab and sets and removes its overrides", async () => {
    const { peer } = await opened();
    const mass = `${CRATE_PREFAB.entities[0]?.uid ?? ""}/components/01M4XQ7K3N8V2D5R0B6G1HT9WT/props/mass`;
    expect(
      await apply(peer, [
        {
          op: "instantiate",
          entity: "Q",
          name: "Crate 2",
          parent: "A",
          transform: at(0, 3),
          instance: { scene: { $asset: "prefabs/crate.prefab.json" } },
        },
        { op: "setOverride", entity: "Q", override: { path: mass, value: 9 } },
        { op: "setOverride", entity: "P", override: { path: mass, value: 4 } },
        { op: "removeOverride", entity: "P", path: mass },
      ]),
    ).toEqual({ applied: 4, failures: [] });
    const all = await readAll(peer);
    expect(all.order).toEqual(["A", "C", "Q", "B", "P"]);
    expect(all.byUid.get("Q")?.instance?.overrides).toEqual([{ path: mass, value: 9 }]);
    expect(all.byUid.get("P")?.instance?.overrides).toBeUndefined();
    // P was rebuilt twice; B's reference to it follows the rebuilt entity.
    expect(all.byUid.get("B")?.components).toEqual([
      { uid: "B-F", type: "game/Follow", props: { target: { $entity: "P" } } },
    ]);
  });

  it("reads an instance's overrides back as the document lists them, until its members change (B4)", async () => {
    const { app, peer } = await opened();
    const [crate, lid, base] = CRATE_PREFAB.entities.map((record) => record.uid);
    // A member's transform before the root's prop, against the serializer's file order, and an
    // override equal to the prefab's value, which the serializer leaves out.
    const overrides = [
      { path: `${lid ?? ""}/transform/position`, value: [0, 2, 0] },
      { path: `${crate ?? ""}/components/01M4XQ7K3N8V2D5R0B6G1HT9WT/props/mass`, value: 3 },
      { path: `${base ?? ""}/transform/position`, value: [0, -0.5, 0] },
    ];
    const instance = { scene: { $asset: "prefabs/crate.prefab.json" }, overrides };
    const file: SceneFile = {
      ...FILE,
      entities: FILE.entities.map((record) => (record.uid === "P" ? Object.assign({}, record, { instance }) : record)),
    };
    expect(await call(peer, "openScene", { file, address: "scenes/ops.scene.json" })).toHaveProperty("result");
    expect(
      await apply(peer, [
        { op: "instantiate", entity: "Q", name: "Crate 2", parent: null, transform: at(7), instance },
      ]),
    ).toEqual({ applied: 1, failures: [] });

    const all = await readAll(peer);
    expect(all.byUid.get("P")?.instance?.overrides).toEqual(overrides);
    expect(all.byUid.get("Q")?.instance?.overrides).toEqual(overrides);

    // Something other than an op moves a member: the serializer's list shows it once the cached
    // index is read again (an unrelated op).
    const member = app.world.getEntity("P")?.children.find((child) => child.name === "Lid");
    member?.transform.localPosition.set(0, 4, 0);
    await apply(peer, [{ op: "setEntityField", entity: "B", field: "name", value: "B2" }]);
    const moved = await readAll(peer);
    expect(moved.byUid.get("P")?.instance?.overrides).toEqual([overrides[1], { ...overrides[0], value: [0, 4, 0] }]);
    expect(moved.byUid.get("Q")?.instance?.overrides).toEqual(overrides);
  });

  it("reads a multi-root member's prop override set before its transform override in that order (B4)", async () => {
    const { peer } = await opened();
    const right = PAIR_PREFAB.entities[1];
    const body = right?.components?.[0]?.uid ?? "";
    const mass = { path: `${right?.uid ?? ""}/components/${body}/props/mass`, value: 6 };
    const position = { path: `${right?.uid ?? ""}/transform/position`, value: [1, 0.3, 0] };
    const scene = { $asset: "prefabs/pair.prefab.json" };
    // The editor's order: the prop first, then the transform, each appended by its own command. The
    // serializer writes an entity's transform before its components. The transform's op is sent as
    // the editor's command has it, which editor-core's document holds canonical.
    expect(
      await apply(peer, [
        { op: "instantiate", entity: "R", name: "Pair", parent: null, transform: at(9), instance: { scene } },
      ]),
    ).toEqual({ applied: 1, failures: [] });
    expect(await apply(peer, [{ op: "setOverride", entity: "R", override: mass }])).toEqual({
      applied: 1,
      failures: [],
    });
    const sent = { op: "replace" as const, path: position.path, value: [1, 0.1 + 0.2, 0] };
    expect(await apply(peer, [{ op: "setOverride", entity: "R", override: sent }])).toEqual({
      applied: 1,
      failures: [],
    });
    expect((await readAll(peer)).byUid.get("R")?.instance?.overrides).toEqual([mass, position]);

    // Editing the first one in place keeps its place.
    const heavier = { ...mass, value: 8 };
    expect(await apply(peer, [{ op: "setOverride", entity: "R", override: heavier }])).toEqual({
      applied: 1,
      failures: [],
    });
    const edited = await readAll(peer);
    expect(edited.byUid.get("R")?.instance?.overrides).toEqual([heavier, position]);

    // Reopened from the document, the order holds.
    const record = edited.byUid.get("R");
    expect(record).toBeDefined();
    const file: SceneFile = {
      ...FILE,
      entities: [
        ...FILE.entities,
        { ...(record as SceneFileEntity), instance: { scene, overrides: [heavier, position] } },
      ],
    };
    expect(await call(peer, "openScene", { file, address: "scenes/ops.scene.json" })).toHaveProperty("result");
    expect((await readAll(peer)).byUid.get("R")?.instance?.overrides).toEqual([heavier, position]);
  });

  it("reports each op the world disagrees with, and applies the rest", async () => {
    const { peer } = await opened();
    const result = await apply(peer, [
      { op: "destroyEntity", entity: "nope" },
      { op: "createEntity", entity: { uid: "A", name: "Again", parent: null, transform: at(0) } },
      { op: "createEntity", entity: { uid: "Z", name: "Z", parent: "nope", transform: at(0) } },
      { op: "reparent", entity: "A", parent: "C" },
      { op: "reorder", entity: "B", index: 9 },
      { op: "removeComponent", component: "nope" },
      { op: "setProp", component: "A-H", path: ["nope"], value: 1 },
      { op: "setProp", component: "A-H", path: ["max"], value: "lots" },
      { op: "setEntityField", entity: "B", field: "layer", value: "Nope" },
      { op: "setOverride", entity: "B", override: { path: "X/name", value: "x" } },
      { op: "removeOverride", entity: "P", path: "X/name" },
      { op: "addComponent", entity: "B", component: { uid: "A-H", type: "game/Health" } },
      { op: "addComponent", entity: "B", component: { uid: "B-I", type: "game/Inventory" } },
      { op: "setEntityField", entity: "B", field: "name", value: "Still applied" },
    ]);
    expect(codes(result)).toEqual([
      ApplyOpFailureCode.unknownEntity,
      ApplyOpFailureCode.duplicateUid,
      ApplyOpFailureCode.invalidParent,
      ApplyOpFailureCode.invalidParent,
      ApplyOpFailureCode.invalidIndex,
      ApplyOpFailureCode.unknownComponent,
      ApplyOpFailureCode.invalidPath,
      ApplyOpFailureCode.invalidValue,
      ApplyOpFailureCode.invalidValue,
      ApplyOpFailureCode.notAnInstance,
      ApplyOpFailureCode.unknownOverride,
      ApplyOpFailureCode.duplicateUid,
      ApplyOpFailureCode.engineError,
    ]);
    expect(result).toHaveProperty("applied", 1);
    expect((await readAll(peer)).byUid.get("B")?.name).toBe("Still applied");
  });

  it("keeps the selection to document entities across ops", async () => {
    const { peer } = await opened();
    expect((await call(peer, "select", { entities: ["B", "C"] }))["result"]).toEqual({ entities: ["B", "C"] });
    await apply(peer, [{ op: "destroyEntity", entity: "C" }]);
    expect((await call(peer, "select", { entities: ["B", "C"] }))["result"]).toEqual({ entities: ["B"] });
  });
});
