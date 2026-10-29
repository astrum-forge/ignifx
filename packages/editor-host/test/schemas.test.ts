import { asset, componentRef, describeRegisteredSchemas, f32, Script, str, u32 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { isSchemaSet, PROTOCOL_VERSION, SceneNotification } from "../src/protocol/index.js";
import { ArmoredHealth, Health, Regen, startLiveHost } from "./support/scene-project.js";
import type { Received } from "./support/editor.js";
import type { LiveHost, Wire } from "./support/scene-project.js";
import type { App, AssetTypeToken, ConcreteComponentType } from "@ignifx/core";

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

  static requires = [Health];
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

/** A class between `game/ArmoredHealth` and `game/TitanHealth` that is never registered. */
class PlatedHealth extends ArmoredHealth {}

/** Two registered ancestors away from `game/Health`, through an unregistered one. */
class TitanHealth extends PlatedHealth {
  static override typeId = "game/TitanHealth";
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
   * @param scripts - The classes the project registers besides the fixture's own.
   * @returns The app, the editor's end, and the schemas the host announced at start.
   */
  async function started(
    scripts: readonly ConcreteComponentType[] = [Turret],
  ): Promise<{ readonly app: App; readonly peer: Wire; readonly schemas: Received }> {
    live = startLiveHost(scripts);
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
    const { propsSchema, extends: ancestry, ...description } = turret;
    expect(description).toEqual(describeRegisteredSchemas(app.world.registry)["game/Turret"]);
    // Neither `Script` nor the class `Script.define` makes is registered.
    expect(ancestry).toEqual([]);
    // Engine ask E33: `requires` reaches the editor, which adds the required components itself.
    expect(turret).toMatchObject({
      title: "Turret",
      format: "components",
      allowMultiple: false,
      package: "game",
      requires: ["game/Health"],
    });
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
    expect(member(schemas, "game/Health")).not.toHaveProperty("requires");
  });

  it("lists the registered classes a component extends, nearest first, as engine ask E44 asks", async () => {
    const { app, schemas } = await started([TitanHealth]);
    // `PlatedHealth` inherits `game/ArmoredHealth` as its typeId but is not that registration.
    expect(member(schemas, "game/TitanHealth")["extends"]).toEqual(["game/ArmoredHealth", "game/Health"]);
    expect(member(schemas, "game/ArmoredHealth")["extends"]).toEqual(["game/Health"]);
    // A class with no registered ancestor sends an empty list, so an absent one means an older host.
    expect(member(schemas, "game/Health")["extends"]).toEqual([]);
    expect(member(schemas, "ignifx/Transform")["extends"]).toEqual([]);
    expect(member(schemas, "ignifx/scene-file")).not.toHaveProperty("extends");

    // The rule an editor mirrors: `game/Regen` requires `game/Health`, which a component listing it
    // in `extends` already is, so adding `Regen` adds nothing.
    expect(member(schemas, "game/Regen")["requires"]).toEqual(["game/Health"]);
    const entity = app.world.createEntity("titan");
    const titan = entity.addComponent(TitanHealth);
    entity.addComponent(Regen);
    expect(entity.getComponents(Health)).toEqual([titan]);
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
