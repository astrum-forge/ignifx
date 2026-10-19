import { asset, componentRef, describeRegisteredSchemas, f32, Script, str, u32 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { isSchemaSet, PROTOCOL_VERSION, SceneNotification } from "../src/protocol/index.js";
import { Health, startLiveHost } from "./support/scene-project.js";
import type { Received } from "./support/editor.js";
import type { LiveHost, Wire } from "./support/scene-project.js";
import type { App, AssetTypeToken } from "@ignifx/core";

/**
 * Engine ask E12b: the host describes the live registry with core's `describeRegisteredSchemas`,
 * so a project's own scripts reach the editor with their inspector metadata, and a hot reload that
 * changes a script's fields is announced with `schemasChanged`.
 */

/** A texture's asset type token. */
const SKIN: AssetTypeToken<{ readonly width: number }> = { assetType: "texture" };

/** A project script that declares every piece of inspector metadata the editor reads. */
class Turret extends Script.define({
  speed: f32(2, { step: 0.25, min: 0, group: "Motion", tooltip: "Turn rate, in turns a second." }),
  ammo: u32(30, { readonly: true, group: "Combat" }),
  seed: u32(7, { hidden: true }),
  skin: asset(SKIN),
  target: componentRef(Health),
}) {
  static typeId = "game/Turret";

  static allowMultiple = false;
}

/** The same script after an edit that adds a field. */
class TurretWithRange extends Script.define({
  speed: f32(2, { step: 0.25, min: 0, group: "Motion", tooltip: "Turn rate, in turns a second." }),
  ammo: u32(30, { readonly: true, group: "Combat" }),
  seed: u32(7, { hidden: true }),
  skin: asset(SKIN),
  target: componentRef(Health),
  range: f32(12, { step: 0.5, group: "Combat" }),
}) {
  static typeId = "game/Turret";

  static allowMultiple = false;
}

/** A script the project adds while the view is open. */
class Beacon extends Script.define({ label: str("Beacon", { group: "Display" }) }) {
  static typeId = "game/Beacon";
}

/**
 * One member of a record, as a record.
 *
 * @param value - The record.
 * @param key - The member.
 * @returns It.
 */
function member(value: unknown, key: string): Received {
  const inner: unknown = typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
    throw new Error(`Member "${key}" is not an object.`);
  }
  return Object.fromEntries(Object.entries(inner));
}

describe("the host's schema descriptions", () => {
  let live: LiveHost | null = null;

  afterEach(async () => {
    await live?.dispose();
    live = null;
  });

  /**
   * Starts a host whose project registers {@link Turret}, and takes its first `schemasChanged`.
   *
   * @returns The app, the editor's end, and the schemas the host announced at start.
   */
  async function started(): Promise<{ readonly app: App; readonly peer: Wire; readonly schemas: Received }> {
    live = startLiveHost([Turret]);
    const peer = live.wire;
    await peer.request({
      jsonrpc: "2.0",
      id: 1,
      method: "hello",
      params: { editorVersion: "0.1.0", protocol: PROTOCOL_VERSION },
    });
    live.release();
    const host = await live.host;
    const params = member(await peer.notification(SceneNotification.schemasChanged), "params");
    expect(isSchemaSet(params)).toBe(true);
    return { app: host.app, peer, schemas: member(params, "schemas") };
  }

  it("describes a project's script with its inspector metadata, as describeRegisteredSchemas does", async () => {
    const { app, schemas } = await started();
    const turret = member(schemas, "game/Turret");
    const { propsSchema, ...description } = turret;
    expect(description).toEqual(describeRegisteredSchemas(app.world.registry)["game/Turret"]);
    expect(turret).toMatchObject({ title: "Turret", format: "components", allowMultiple: false, package: "game" });
    expect(member(turret, "fields")).toEqual({
      speed: {
        kind: "f32",
        default: 2,
        description: "Turn rate, in turns a second.",
        min: 0,
        step: 0.25,
        group: "Motion",
      },
      ammo: { kind: "u32", default: 30, readonly: true, group: "Combat" },
      seed: { kind: "u32", default: 7, hidden: true },
      skin: { kind: "asset", default: null, assetType: "texture" },
      target: { kind: "componentRef", default: null, componentType: "game/Health" },
    });
    expect(member(member(propsSchema, "properties"), "speed")).toMatchObject({ "x-ignifx-step": 0.25 });
    // A component the project registers allows several per entity unless it says otherwise.
    expect(member(schemas, "game/Health")).toMatchObject({ allowMultiple: true, package: "game" });
  });

  it("names the extension that registered an engine component", async () => {
    const { schemas } = await started();
    expect(member(schemas, "ignifx/Camera")).toMatchObject({ package: "@ignifx/core", allowMultiple: false });
    expect(member(schemas, "ignifx/Transform")).toMatchObject({ package: "@ignifx/core", builtIn: true });
  });

  it("announces a hot reload that adds a field, and one that adds a script, with schemasChanged", async () => {
    const { app, peer } = await started();

    app.hotReload.apply([{ types: [TurretWithRange] }]);
    await peer.notification(SceneNotification.hotReloaded);
    const changed = member(member(await peer.notification(SceneNotification.schemasChanged), "params"), "schemas");
    const fields = member(member(changed, "game/Turret"), "fields");
    expect(Object.keys(fields)).toEqual(["speed", "ammo", "seed", "skin", "target", "range"]);
    expect(fields["range"]).toEqual({ kind: "f32", default: 12, step: 0.5, group: "Combat" });

    app.hotReload.apply([{ types: [Beacon] }]);
    await peer.notification(SceneNotification.hotReloaded);
    const added = member(member(await peer.notification(SceneNotification.schemasChanged), "params"), "schemas");
    expect(member(added, "game/Beacon")).toMatchObject({
      title: "Beacon",
      package: "game",
      fields: { label: { kind: "str", default: "Beacon", group: "Display" } },
    });

    // `getSchemas` answers from the same live registry.
    const answer = await peer.request({ jsonrpc: "2.0", id: 2, method: "getSchemas" });
    const schemas = member(member(answer, "result"), "schemas");
    expect(Object.keys(member(member(schemas, "game/Turret"), "fields"))).toContain("range");
    expect(Object.keys(schemas)).toContain("game/Beacon");
  });
});
