import { afterEach, describe, expect, it } from "vitest";
import { ApplyOpFailureCode, SceneNotification } from "../src/protocol/index.js";
import { startLiveHost } from "./support/scene-project.js";
import type { LiveHost, Wire } from "./support/scene-project.js";
import type { SceneOp } from "../src/protocol/index.js";

/**
 * An op path walks the document's own keys only: `__proto__` names the prototype of every object,
 * not a key the document has, so a path through it does not resolve.
 */

let live: LiveHost | null = null;
let next = 100;

afterEach(async () => {
  await live?.dispose();
  live = null;
});

/**
 * Starts a host and opens an empty scene.
 *
 * @returns The editor's end.
 */
async function opened(): Promise<Wire> {
  live = startLiveHost();
  const peer = live.wire;
  await peer.request({
    jsonrpc: "2.0",
    id: 1,
    method: "hello",
    params: { editorVersion: "0.1.0", protocol: { major: 0, minor: 3 } },
  });
  live.release();
  await live.host;
  await peer.notification(SceneNotification.schemasChanged);
  next += 1;
  await peer.request({
    jsonrpc: "2.0",
    id: next,
    method: "openScene",
    params: {
      file: { format: "ignifx.scene", formatVersion: 1, name: "proto", entities: [] },
      address: "scenes/proto.scene.json",
    },
  });
  return peer;
}

/**
 * Applies ops as one command.
 *
 * @param peer - The editor's end.
 * @param ops - The ops.
 * @returns The result.
 */
async function apply(peer: Wire, ops: readonly SceneOp[]): Promise<unknown> {
  next += 1;
  const answer = await peer.request({
    jsonrpc: "2.0",
    id: next,
    method: "applyOps",
    params: { ops, commandName: "Test", commandId: `cmd-${String(next)}` },
  });
  return answer["result"];
}

/**
 * Reads the scene's settings back.
 *
 * @param peer - The editor's end.
 * @returns The settings.
 */
async function settings(peer: Wire): Promise<unknown> {
  next += 1;
  const answer = await peer.request({ jsonrpc: "2.0", id: next, method: "readBack", params: {} });
  return (answer["result"] as { readonly settings: unknown }).settings;
}

describe("an op path through __proto__", () => {
  it("does not resolve when the document has no such key", async () => {
    const peer = await opened();
    await apply(peer, [{ op: "setSceneSetting", path: ["fog"], value: { density: 1 } }]);
    const result = await apply(peer, [{ op: "setSceneSetting", path: ["__proto__", "density"], value: 2 }]);
    expect(result).toMatchObject({ applied: 0, failures: [{ code: ApplyOpFailureCode.invalidPath }] });
    expect(await settings(peer)).toEqual({ fog: { density: 1 } });
  });

  it("reaches a __proto__ key the document holds as data", async () => {
    const peer = await opened();
    const value = JSON.parse('{ "__proto__": { "density": 1 } }') as Record<string, unknown>;
    await apply(peer, [{ op: "setSceneSetting", path: [], value } as SceneOp]);
    expect(await apply(peer, [{ op: "setSceneSetting", path: ["__proto__", "density"], value: 2 }])).toEqual({
      applied: 1,
      failures: [],
    });
    const read = await settings(peer);
    expect(Object.getOwnPropertyDescriptor(read, "__proto__")?.value).toEqual({ density: 2 });
  });
});
