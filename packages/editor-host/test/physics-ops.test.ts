import { physics } from "@ignifx/physics";
import { physics2d } from "@ignifx/physics-2d";
import { afterEach, describe, expect, it } from "vitest";
import { SceneNotification } from "../src/protocol/index.js";
import { startLiveHost } from "./support/scene-project.js";
import type { Received } from "./support/editor.js";
import type { LiveHost, Wire } from "./support/scene-project.js";
import type { App, Extension, SceneFile } from "@ignifx/core";

/**
 * An inspector edit reaches the physics world (ADR-0028, amendment of 2026-10-20): `applyOps`
 * changes a collider's field, the host calls the component's `onValidate`, and the body is rebuilt,
 * so a query and `getColliderOutlines` see the new size at once, with no step.
 */

let live: LiveHost | null = null;
let next = 100;

afterEach(async () => {
  await live?.dispose();
  live = null;
});

/**
 * A scene of one entity, `Pad`, at the origin, carrying one collider.
 *
 * @param type - The collider's type id.
 * @param props - Its props.
 * @returns The file.
 */
function padScene(type: string, props: Record<string, unknown>): SceneFile {
  return {
    format: "ignifx.scene",
    formatVersion: 1,
    name: "pad",
    entities: [
      {
        uid: "PAD",
        name: "Pad",
        parent: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: [{ uid: "PAD-C", type, props: props as never }],
      },
    ],
  } as SceneFile;
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
 * Starts a host with one extension and opens a scene.
 *
 * @param extension - `physics()` or `physics2d()`.
 * @param file - The scene to open.
 * @returns The app and the editor's end.
 */
async function opened(extension: Extension, file: SceneFile): Promise<{ readonly app: App; readonly peer: Wire }> {
  live = startLiveHost([], [extension]);
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
  expect(await call(peer, "openScene", { file, address: "scenes/pad.scene.json" })).toHaveProperty(
    "result.entityCount",
    1,
  );
  return { app: host.app, peer };
}

/**
 * Sets one field of the pad's collider through `applyOps`.
 *
 * @param peer - The editor's end.
 * @param field - The field.
 * @param value - Its JSON value.
 */
async function setField(peer: Wire, field: string, value: unknown): Promise<void> {
  const answer = await call(peer, "applyOps", {
    ops: [{ op: "setProp", component: "PAD-C", path: [field], value }],
    commandName: `Set ${field}`,
    commandId: `cmd-${String(next)}`,
  });
  expect(answer).toHaveProperty("result.applied", 1);
}

/**
 * The widest `|x|` of the pad's outline, from `getColliderOutlines`.
 *
 * @param peer - The editor's end.
 * @returns Half the outline's width.
 */
async function outlineHalfWidth(peer: Wire): Promise<number> {
  const answer = await call(peer, "getColliderOutlines", { entities: ["PAD"] });
  const outlines = (answer["result"] as { outlines: { lines: number[] }[] }).outlines;
  expect(outlines).toHaveLength(1);
  const lines = outlines[0]?.lines ?? [];
  let widest = 0;
  for (let index = 0; index < lines.length; index += 3) {
    widest = Math.max(widest, Math.abs(lines[index] ?? 0));
  }
  return widest;
}

describe("a collider field edited through applyOps", () => {
  it("rebuilds the 3D body, so a raycast and the outline see the new size", async () => {
    const { app, peer } = await opened(physics(), padScene("ignifx/BoxCollider", { size: [1, 1, 1] }));
    const down = { x: 0, y: -1, z: 0 };
    expect(app.physics.raycast({ x: 2, y: 10, z: 0 }, down, 20)).toBeNull();
    expect(await outlineHalfWidth(peer)).toBeCloseTo(0.5);

    await setField(peer, "size", [6, 1, 1]);
    expect(app.physics.raycast({ x: 2, y: 10, z: 0 }, down, 20)?.entity.name).toBe("Pad");
    expect(await outlineHalfWidth(peer)).toBeCloseTo(3);
    expect(app.diagnostics.frame.fixedSteps).toBe(0);
  }, 30_000);

  it("rebuilds the 2D body, so a raycast and the outline see the new size", async () => {
    const { app, peer } = await opened(physics2d(), padScene("ignifx/BoxCollider2D", { size: [1, 1] }));
    const down = { x: 0, y: -1 };
    expect(app.physics2d.raycast({ x: 2, y: 10 }, down, 20)).toBeNull();
    expect(await outlineHalfWidth(peer)).toBeCloseTo(0.5);

    await setField(peer, "size", [6, 1]);
    expect(app.physics2d.raycast({ x: 2, y: 10 }, down, 20)?.entity.name).toBe("Pad");
    expect(await outlineHalfWidth(peer)).toBeCloseTo(3);
  }, 30_000);

  it("rebuilds after a field is reset to its default", async () => {
    const { app, peer } = await opened(physics(), padScene("ignifx/BoxCollider", { size: [6, 1, 1] }));
    const down = { x: 0, y: -1, z: 0 };
    expect(app.physics.raycast({ x: 2, y: 10, z: 0 }, down, 20)?.entity.name).toBe("Pad");
    const answer = await call(peer, "applyOps", {
      ops: [{ op: "setProp", component: "PAD-C", path: ["size"] }],
      commandName: "Reset size",
      commandId: "cmd-reset",
    });
    expect(answer).toHaveProperty("result.applied", 1);
    expect(app.physics.raycast({ x: 2, y: 10, z: 0 }, down, 20)).toBeNull();
  }, 30_000);
});
