import { threeD } from "@ignifx/3d";
import { Camera } from "@ignifx/core";
import { input } from "@ignifx/input";
import { physics } from "@ignifx/physics";
import { afterEach, describe, expect, it } from "vitest";
import { SceneNotification } from "../src/protocol/index.js";
import { startLiveHost } from "./support/scene-project.js";
import type { Received } from "./support/editor.js";
import type { LiveHost, Wire } from "./support/scene-project.js";
import type { SceneOp } from "../src/protocol/index.js";
import type { App, SceneFile, SceneFileEntity, Vec3Like } from "@ignifx/core";

/**
 * A `LodGroup` in the scene view (engine ADR-0028; editor audit defect B1): the LOD switch writes
 * `MeshRenderer.enabled`, which scene files save, so moving the editor camera must not change what
 * `readBack` returns, and removing the group must not switch its levels off.
 */

let live: LiveHost | null = null;
let next = 100;

afterEach(async () => {
  await live?.dispose();
  live = null;
});

/** A transform at a position. */
const at = (x: number): SceneFileEntity["transform"] => ({
  position: [x, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

/** A tree at the origin with two levels of detail, and a marker far away to frame the camera out to. */
const FILE: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "lod",
  entities: [
    {
      uid: "TREE",
      name: "Tree",
      parent: null,
      transform: at(0),
      components: [
        {
          uid: "TREE-LOD",
          type: "ignifx/LodGroup",
          props: {
            levels: [
              { distance: 10, renderer: { $component: "NEAR-R" } },
              { distance: 50, renderer: { $component: "FAR-R" } },
            ],
            hysteresis: 0,
          },
        },
      ],
    },
    {
      uid: "NEAR",
      name: "Near",
      parent: "TREE",
      transform: at(0),
      components: [{ uid: "NEAR-R", type: "ignifx/MeshRenderer" }],
    },
    {
      uid: "FAR",
      name: "Far",
      parent: "TREE",
      transform: at(0),
      components: [{ uid: "FAR-R", type: "ignifx/MeshRenderer" }],
    },
    { uid: "MARKER", name: "Marker", parent: null, transform: at(1000) },
  ],
};

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
 * Starts a host with the 3D toolkit and opens {@link FILE}.
 *
 * @returns The app and the editor's end.
 */
async function opened(): Promise<{ readonly app: App; readonly peer: Wire }> {
  live = startLiveHost([], [physics(), input(), threeD()]);
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
  expect(await call(peer, "openScene", { file: FILE, address: "scenes/lod.scene.json" })).toHaveProperty(
    "result.entityCount",
    4,
  );
  return { app: host.app, peer };
}

/**
 * Waits until the app has run a few more frames, so `PreRender` systems have seen the camera.
 *
 * @param app - The host's app, which the live host steps on a timer.
 */
async function frames(app: App): Promise<void> {
  const target = app.time.frameCount + 3;
  while (app.time.frameCount < target) {
    // oxlint-disable-next-line no-await-in-loop -- waiting for the pump, one tick at a time
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/**
 * Where the editor camera is: the enabled camera with the highest priority.
 *
 * @param app - The host's app.
 * @returns Its world position.
 */
function eye(app: App): Vec3Like {
  const cameras = app.world.components(Camera).filter((camera) => camera.isEnabledInHierarchy);
  const best = cameras.reduce((a, b) => (b.priority > a.priority ? b : a));
  const p = best.entity.transform.position;
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * Reads the whole document back.
 *
 * @param peer - The editor's end.
 * @returns The records.
 */
async function readBack(peer: Wire): Promise<readonly SceneFileEntity[]> {
  const answer = await call(peer, "readBack", {});
  return (answer["result"] as { readonly entities: readonly SceneFileEntity[] }).entities;
}

/**
 * Applies one op as a command and expects it to succeed.
 *
 * @param peer - The editor's end.
 * @param op - The op.
 */
async function applyOne(peer: Wire, op: SceneOp): Promise<void> {
  next += 1;
  const answer = await call(peer, "applyOps", { ops: [op], commandName: "Test", commandId: `cmd-${String(next)}` });
  expect(answer["result"]).toEqual({ applied: 1, failures: [] });
}

/**
 * Renames the far marker, an edit that has nothing to do with the LOD group.
 *
 * @param peer - The editor's end.
 * @param name - The new name.
 */
async function rename(peer: Wire, name: string): Promise<void> {
  await applyOne(peer, { op: "setEntityField", entity: "MARKER", field: "name", value: name });
}

/**
 * The two level renderers' records, as read back.
 *
 * @param records - A `readBack`'s entities.
 * @returns The `NEAR` and `FAR` renderers' component records.
 */
function levelsOf(records: readonly SceneFileEntity[]): unknown[] {
  return ["NEAR", "FAR"].map((uid) => records.find((record) => record.uid === uid)?.components?.[0]);
}

/**
 * A level renderer as the document has it: enabled, so `enabled` is omitted.
 *
 * @param uid - The component's uid.
 * @returns A matcher for its record.
 */
function authored(uid: string): unknown {
  return {
    uid,
    type: "ignifx/MeshRenderer",
    props: expect.objectContaining({ mesh: null }) as unknown,
  };
}

describe("a LodGroup in the scene view", () => {
  it("reads back the authored levels while the editor camera moves near and far", async () => {
    const { app, peer } = await opened();
    await frames(app);
    const before = await readBack(peer);
    expect(levelsOf(before)).toEqual([authored("NEAR-R"), authored("FAR-R")]);

    const eyes: number[] = [];
    for (const entities of [["TREE"], "all", ["TREE"]]) {
      // oxlint-disable-next-line no-await-in-loop -- each move must be drawn before it is read back
      expect(await call(peer, "frame", { entities })).toHaveProperty("result", null);
      // oxlint-disable-next-line no-await-in-loop -- see above
      await frames(app);
      const position = eye(app);
      eyes.push(Math.hypot(position.x, position.y, position.z));
      // The host serializes once per change, so an unrelated edit makes it read the world again.
      // oxlint-disable-next-line no-await-in-loop -- see above
      await rename(peer, `Marker ${String(eyes.length)}`);
      // oxlint-disable-next-line no-await-in-loop -- see above
      const after = await readBack(peer);
      expect(levelsOf(after)).toEqual(levelsOf(before));
      expect(after.filter((record) => record.uid !== "MARKER")).toEqual(
        before.filter((record) => record.uid !== "MARKER"),
      );
    }
    // The camera really went inside the first level and past the last one.
    expect(eyes[0]).toBeLessThan(10);
    expect(eyes[1]).toBeGreaterThan(50);
  });

  it("leaves the levels enabled when the group is removed", async () => {
    const { app, peer } = await opened();
    await call(peer, "frame", { entities: ["TREE"] });
    await frames(app);
    await applyOne(peer, { op: "removeComponent", component: "TREE-LOD" });
    await frames(app);
    expect(levelsOf(await readBack(peer))).toEqual([authored("NEAR-R"), authored("FAR-R")]);
  });
});
