import { readFileSync } from "node:fs";
import { decodeProps, describeSchemas, encodeProps, toJsonSchema, transformSchema } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  HostCapability,
  isApplyOpsParams,
  isApplyOpsResult,
  isEntitySelection,
  isFrameParams,
  isHostErrorParams,
  isHotReloadedParams,
  isInvalidSceneFileData,
  isLogParams,
  isOpenSceneParams,
  isOpenSceneResult,
  isPickParams,
  isPickResult,
  isReadBackParams,
  isReadBackResult,
  isRpcMessage,
  isSceneOpenedParams,
  isSchemaSet,
  isScreenshotParams,
  isScreenshotResult,
  isSetGizmoParams,
  isSetViewModeParams,
  isTransformDraggedParams,
  isTransformDraggingParams,
  PROTOCOL_VERSION,
  RpcErrorCode,
  SceneMethod,
  SceneNotification,
} from "../src/protocol/index.js";
import { Exploder, Health, startLiveHost } from "./support/scene-project.js";
import type { Received } from "./support/editor.js";
import type { LiveHost, Wire } from "./support/scene-project.js";
import type { App, JsonObject, SceneFile, SceneFileEntity } from "@ignifx/core";

/**
 * Wire compatibility with the editor, protocol 0.3. `fixtures/host-0.3-wire.json` is copied
 * unchanged from the editor repository (`packages/editor-protocol/test/fixtures/`), where
 * `wire-0.3.test.ts` checks it against `@ignifx/editor-protocol` 0.3; change it there first.
 * Here every message in it goes through this package's guards, and its requests go through a live
 * headless host, whose answers must be the fixture's: the `game/Health` and `ignifx/Transform`
 * schema entries byte for byte, so that the two copies cannot drift apart unnoticed.
 *
 * Where the host's answer cannot be the fixture's byte for byte, the difference is the host's
 * truth and is stated where it is checked: a headless host lists only `heartbeat` (no gizmos, no
 * screenshot, no 2D view), and three texts are the engine's own (the validation message, the
 * hash-mismatch warning, a serialized component's default props). `fixtures/host-0.3-applied.json`
 * is the document editor-core produces from the fixture's ops; the live `readBack` must equal it.
 */

/** Reads a fixture file's `messages` or `file` member. */
const WIRE = readJson("fixtures/host-0.3-wire.json", "messages");
const APPLIED = readJson("fixtures/host-0.3-applied.json", "file");

/**
 * Reads one member of a JSON fixture.
 *
 * @param path - The fixture, relative to this file.
 * @param key - The member.
 * @returns It, as a record.
 */
function readJson(path: string, key: string): Received {
  const parsed: unknown = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const value: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, key) : undefined;
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} has no ${key}.`);
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * One fixture message.
 *
 * @param name - Its name.
 * @returns The message.
 */
function wire(name: string): Received {
  const value: unknown = WIRE[name];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The fixture has no message "${name}".`);
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * One member of a message, as a record.
 *
 * @param message - The message.
 * @param key - The member.
 * @returns It.
 */
function member(message: Received, key: string): Received {
  const value = message[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Member "${key}" is not an object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * Asserts a live message equals the fixture's, key order included.
 *
 * @param actual - What the host sent.
 * @param expected - The fixture's message.
 */
function expectWire(actual: Received, expected: unknown): void {
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

/** Each params guard of the protocol, by the fixture messages it checks. */
const PARAMS_GUARDS: Readonly<Record<string, (value: unknown) => boolean>> = {
  openScene: isOpenSceneParams,
  openSceneBeforeStart: isOpenSceneParams,
  applyOps: isApplyOpsParams,
  applyOpsPartial: isApplyOpsParams,
  readBack: isReadBackParams,
  readBackAll: isReadBackParams,
  select: isEntitySelection,
  setGizmo: isSetGizmoParams,
  setGizmoNoSnap: isSetGizmoParams,
  frame: isFrameParams,
  frameAll: isFrameParams,
  pick: isPickParams,
  pickBacking: isPickParams,
  screenshot: isScreenshotParams,
  screenshotJpeg: isScreenshotParams,
  setViewMode: isSetViewModeParams,
  sceneOpened: isSceneOpenedParams,
  schemasChangedAtStart: isSchemaSet,
  schemasChanged: isSchemaSet,
  hotReloaded: isHotReloadedParams,
  hotReloadedWithErrors: isHotReloadedParams,
  selectionChanged: isEntitySelection,
  selectionCleared: isEntitySelection,
  transformDragging: isTransformDraggingParams,
  transformDragged: isTransformDraggedParams,
  hostError: isHostErrorParams,
  hostErrorBare: isHostErrorParams,
  log: isLogParams,
};

/** Each result guard, by the fixture messages it checks. */
const RESULT_GUARDS: Readonly<Record<string, (value: unknown) => boolean>> = {
  openSceneResponse: isOpenSceneResult,
  applyOpsResponse: isApplyOpsResult,
  applyOpsPartialResponse: isApplyOpsResult,
  readBackResponse: isReadBackResult,
  selectResponse: isEntitySelection,
  pickResponse: isPickResult,
  pickMiss: isPickResult,
  screenshotResponse: isScreenshotResult,
  getSchemasResponse: isSchemaSet,
};

describe("the editor's 0.3 wire fixture, through the host's guards", () => {
  it.each(Object.keys(WIRE))("accepts %s as a JSON-RPC message", (name) => {
    expect(isRpcMessage(wire(name))).toBe(true);
  });

  it.each(Object.entries(PARAMS_GUARDS))("accepts the params of %s", (name, guard) => {
    expect(guard(wire(name)["params"])).toBe(true);
  });

  it.each(Object.entries(RESULT_GUARDS))("accepts the result of %s", (name, guard) => {
    expect(guard(wire(name)["result"])).toBe(true);
  });

  it("names only this package's methods, notifications, capabilities and error codes", () => {
    const names: readonly unknown[] = [...Object.values(SceneMethod), ...Object.values(SceneNotification), "hello"];
    const codes: readonly unknown[] = Object.values(RpcErrorCode);
    for (const [name, message] of Object.entries(WIRE)) {
      const record = wire(name);
      if ("method" in record) {
        expect(names, name).toContain(record["method"]);
      }
      if ("error" in record) {
        expect(codes, name).toContain(member(record, "error")["code"]);
      }
      expect(message).toBeDefined();
    }
    const capabilities: readonly unknown[] = Object.values(HostCapability);
    for (const capability of [member(wire("readyScene"), "result")["capabilities"]].flat()) {
      expect(capabilities).toContain(capability);
    }
    expect(isInvalidSceneFileData(member(wire("openSceneInvalid"), "error")["data"])).toBe(true);
  });

  it("refuses a schema whose step is not positive or whose builtIn is not a boolean", () => {
    const transform = member(member(member(wire("getSchemasResponse"), "result"), "schemas"), "ignifx/Transform");
    const fields = member(transform, "fields");
    const withStep = (step: unknown): unknown => ({
      schemas: { "ignifx/Transform": { ...transform, fields: { ...fields, scale: { kind: "vec3", step } } } },
    });
    expect(isSchemaSet(withStep(0.01))).toBe(true);
    expect(isSchemaSet(withStep(0))).toBe(false);
    expect(isSchemaSet(withStep("0.01"))).toBe(false);
    expect(isSchemaSet({ schemas: { "ignifx/Transform": { ...transform, builtIn: "yes" } } })).toBe(false);
  });
});

/**
 * Turns a document's records into what the engine writes for them: every component's props with
 * the schema's defaults filled in, and each instance entry without its recorded hash, which the
 * engine rewrites as the instanced scene's real one.
 *
 * @param app - The app whose registry and assets decode the props.
 * @param records - The document's records.
 * @returns The records as a live `readBack` writes them.
 */
function asEngineWrites(app: App, records: readonly SceneFileEntity[]): SceneFileEntity[] {
  const references = {
    entity: (): null => null,
    component: (): null => null,
    asset: (address: string) => app.assets.get(address),
  };
  const encoder = {
    entityUid: (): null => null,
    componentUid: (): null => null,
  };
  return records.map((record) => {
    const { instance, components } = record;
    const written: SceneFileEntity = {
      ...record,
      ...(instance === undefined ? {} : { instance: { ...instance, hash: "<hash>" } }),
      ...(components === undefined
        ? {}
        : {
            components: components.map((component) => {
              const type = app.world.registry.get(component.type);
              const schema = type === null ? null : app.world.registry.describe(type).schema;
              if (schema === null) {
                return component;
              }
              const decoded = decodeProps(schema, component.props ?? {}, references);
              return Object.assign(structuredClone(component), { props: encodeProps(schema, decoded.value, encoder) });
            }),
          }),
    };
    return written;
  });
}

/**
 * Replaces every instance hash with a placeholder, as {@link asEngineWrites} does.
 *
 * @param records - Records a live host wrote.
 * @returns The records with hashes masked.
 */
function maskHashes(records: unknown): unknown {
  return Array.isArray(records)
    ? records.map((value: unknown) => {
        if (typeof value !== "object" || value === null) {
          return value;
        }
        const instance: unknown = Reflect.get(value, "instance");
        return instance === undefined ? value : { ...value, instance: { ...instance, hash: "<hash>" } };
      })
    : records;
}

describe("the editor's 0.3 wire fixture, through a live headless host", () => {
  let live: LiveHost | null = null;

  afterEach(async () => {
    await live?.dispose();
    live = null;
  });

  /**
   * Starts the host and runs the handshake.
   *
   * @returns The host's app and the editor's end, once the app has started.
   */
  async function started(): Promise<{ readonly app: App; readonly peer: Wire }> {
    live = startLiveHost();
    const peer = live.wire;
    await peer.request(wire("hello"));
    live.release();
    const host = await live.host;
    await peer.notification(SceneNotification.schemasChanged);
    return { app: host.app, peer };
  }

  it("answers hello, refuses scene methods until the app starts, then sends schemasChanged", async () => {
    live = startLiveHost();
    const peer = live.wire;

    // A headless host lists only `heartbeat`: it draws no gizmos, captures nothing, has no 2D view.
    const ready = wire("readyScene");
    expectWire(await peer.request(wire("hello")), {
      ...ready,
      result: { ...member(ready, "result"), capabilities: [HostCapability.heartbeat] },
    });
    expect(member(member(ready, "result"), "protocol")).toEqual(PROTOCOL_VERSION);

    expectWire(await peer.request(wire("openSceneBeforeStart")), wire("notReadyScene"));

    live.release();
    const host = await live.host;
    const schemas = member(await peer.notification(SceneNotification.schemasChanged), "params");
    expect(isSchemaSet(schemas)).toBe(true);
    const expected = member(member(wire("schemasChangedAtStart"), "params"), "schemas");
    const actual = member(schemas, "schemas");
    expectWire(member(actual, "game/Health"), expected["game/Health"]);
    expectWire(member(actual, "ignifx/Transform"), expected["ignifx/Transform"]);
    expect(member(actual, "ignifx/Camera")["description"]).toBe(member(expected, "ignifx/Camera")["description"]);
    expect(member(actual, "ignifx/scene-file")["format"]).toBe("ignifx.scene");
    expect(Object.keys(actual)).not.toContain("ignifx-editor/EditorCamera");
    expect(host.editorScene.persistent).toBe(true);
  });

  it("answers getSchemas with the schemas it announced", async () => {
    const { peer } = await started();
    const answer = await peer.request(wire("getSchemas"));
    expect(isSchemaSet(answer["result"])).toBe(true);
    const actual = member(member(answer, "result"), "schemas");
    const expected = member(member(wire("getSchemasResponse"), "result"), "schemas");
    for (const typeId of ["game/Health", "ignifx/Transform"]) {
      expectWire(member(actual, typeId), expected[typeId]);
    }
  });

  it("describes the transform with core's schema, marked built-in (engine ask E4)", async () => {
    const { peer } = await started();
    const answer = await peer.request(wire("getSchemas"));
    const schemas = member(member(answer, "result"), "schemas");
    const transform = member(schemas, "ignifx/Transform");
    const core = describeSchemas()["ignifx/Transform"];
    expect(transform["title"]).toBe("Transform");
    expect(transform["builtIn"]).toBe(true);
    expect(transform["fields"]).toEqual(core?.fields);
    expect(transform["propsSchema"]).toEqual(toJsonSchema(transformSchema()));
    // Nothing else the host describes is built-in.
    expect(Object.keys(schemas).filter((typeId) => member(schemas, typeId)["builtIn"] === true)).toEqual([
      "ignifx/Transform",
    ]);
  });

  it("opens the fixture's scene, applies its ops, and reads back the document editor-core produces", async () => {
    const { app, peer } = await started();

    // The fixture's hash is made up, so the host reports IGX-0604 in the engine's own words.
    const opened = await peer.request(wire("openScene"));
    const response = wire("openSceneResponse");
    const result = member(opened, "result");
    expect(isOpenSceneResult(result)).toBe(true);
    expect(result["entityCount"]).toBe(member(response, "result")["entityCount"]);
    const warnings: unknown = result["warnings"];
    const codes: unknown[] = [];
    for (const warning of Array.isArray(warnings) ? warnings : []) {
      const code: unknown = typeof warning === "object" && warning !== null ? Reflect.get(warning, "code") : null;
      codes.push(code);
    }
    expect(codes).toEqual(["IGX-0604"]);
    expectWire(opened, { ...response, result });
    const sceneOpened = wire("sceneOpened");
    expectWire(await peer.notification(SceneNotification.sceneOpened), {
      ...sceneOpened,
      params: { ...member(sceneOpened, "params"), warnings: result["warnings"] },
    });

    expectWire(await peer.request(wire("applyOps")), wire("applyOpsResponse"));

    const read = await peer.request(wire("readBack"));
    const expected = member(wire("readBackResponse"), "result");
    const player = [expected["entities"]].flat().filter((record): record is SceneFileEntity => isRecord(record));
    expectWire(read, { ...wire("readBackResponse"), result: { ...expected, entities: asEngineWrites(app, player) } });

    const all = member(await peer.request({ ...wire("readBackAll"), id: 50 }), "result");
    const document = APPLIED as unknown as SceneFile;
    expect(JSON.stringify(maskHashes(all["entities"]))).toBe(JSON.stringify(asEngineWrites(app, document.entities)));
    expect(all["settings"]).toEqual(document.settings);
    expect(all["missing"]).toEqual([]);

    // The second op fails, and the first one stays applied: the editor reopens the scene then.
    expectWire(await peer.request(wire("applyOpsPartial")), wire("applyOpsPartialResponse"));
    const layered = member(await peer.request({ ...wire("readBack"), id: 51 }), "result");
    expect([layered["entities"]].flat()[0]).toMatchObject({ layer: "Characters" });
  });

  it("refuses a file validateSceneFile refuses, with its issues, and leaves no scene open", async () => {
    const { peer } = await started();
    await peer.request(wire("openScene"));
    const file = member(member(wire("openScene"), "params"), "file") as unknown as SceneFile;
    const entities: unknown[] = [...file.entities];
    const third = file.entities[2];
    entities[2] = { ...third, transform: { ...third?.transform, rotation: [0, 0, 1] } };
    const broken = { ...file, entities };
    const invalid = wire("openSceneInvalid");
    const answer = await peer.request({
      jsonrpc: "2.0",
      id: invalid["id"],
      method: "openScene",
      params: { file: broken, address: null },
    });
    const error = member(answer, "error");
    // The engine words the issue its own way: `entities/2/transform/rotation: expected an array of 4 numbers.`
    expect(error["code"]).toBe(RpcErrorCode.invalidParams);
    expect(String(error["message"])).toMatch(/^The scene file is not valid: entities\/2\/transform/u);
    expect(isInvalidSceneFileData(error["data"])).toBe(true);
    expectWire(await peer.request({ ...wire("readBack"), id: 21 }), {
      ...wire("noScene"),
      error: { code: RpcErrorCode.noScene, message: 'No scene is open; send "openScene" before "readBack".' },
    });
  });

  it("selects document entities only, frames them, and answers the methods that return null", async () => {
    const { app, peer } = await started();
    await peer.request(wire("openScene"));

    expectWire(await peer.request(wire("select")), wire("selectResponse"));
    const stranger = await peer.request({
      jsonrpc: "2.0",
      id: 40,
      method: "select",
      params: { entities: ["nope", "01M4ZEB9E0GG0Q6R22YXV3AVK8", "01M4ZEB9E0GG0Q6R22YXV3AVK8"] },
    });
    expect(member(stranger, "result")).toEqual({ entities: ["01M4ZEB9E0GG0Q6R22YXV3AVK8"] });

    const camera = app.world.findByName("Editor Camera");
    const before = camera?.transform.position;
    expectWire(await peer.request(wire("frame")), { ...wire("nullResponse"), id: wire("frame")["id"] });
    expect(camera?.transform.position).not.toEqual(before);
    expectWire(await peer.request(wire("frameAll")), { ...wire("nullResponse"), id: wire("frameAll")["id"] });

    // A host without `viewMode2d` refuses the fixture's "2d" and accepts "3d".
    expect(member(await peer.request(wire("setViewMode")), "error")["code"]).toBe(RpcErrorCode.invalidParams);
    expectWire(await peer.request({ ...wire("setViewMode"), params: { mode: "3d" } }), {
      ...wire("nullResponse"),
      id: wire("setViewMode")["id"],
    });

    // A headless host lists neither `gizmos` nor `screenshot`, so it does not have their methods.
    for (const name of ["setGizmo", "setGizmoNoSnap", "screenshot", "screenshotJpeg"]) {
      // oxlint-disable-next-line no-await-in-loop -- one request at a time
      expect(member(await peer.request(wire(name)), "error")["code"], name).toBe(RpcErrorCode.methodNotFound);
    }

    expectWire(await peer.request(wire("closeScene")), { ...wire("nullResponse"), id: wire("closeScene")["id"] });
    expectWire(await peer.request(wire("closeScene")), { ...wire("nullResponse"), id: wire("closeScene")["id"] });
    expectWire(
      await peer.request({
        jsonrpc: "2.0",
        id: 21,
        method: "applyOps",
        params: { ops: [], commandName: "Nothing", commandId: "cmd-0" },
      }),
      wire("noScene"),
    );
    expectWire(await peer.request({ ...wire("select"), id: 41 }), { jsonrpc: "2.0", id: 41, result: { entities: [] } });
  });

  it("misses every pick on a headless view, in either unit", async () => {
    const { peer } = await started();
    await peer.request(wire("openScene"));
    expectWire(await peer.request({ ...wire("pick"), id: wire("pickMiss")["id"] }), wire("pickMiss"));
    expectWire(await peer.request(wire("pickBacking")), wire("pickMiss"));
  });

  it("relays hot reloads, the app's errors, and its log", async () => {
    const { app, peer } = await started();

    class HealthV2 extends Health {}
    app.hotReload.apply([{ types: [HealthV2] }]);
    const reloaded = member(await peer.notification(SceneNotification.hotReloaded), "params");
    expect(isHotReloadedParams(reloaded)).toBe(true);
    expect(member(reloaded, "report")["typeIds"]).toEqual(["game/Health"]);
    expect(isSchemaSet(member(await peer.notification(SceneNotification.schemasChanged), "params"))).toBe(true);

    const line = "models/player.glb: 2 textures are not power-of-two; mipmaps are off.";
    app.log.warn(line);
    let log = member(await peer.notification(SceneNotification.log), "params");
    // Everything the app logs is relayed, the hot reload's own line included.
    while (log["message"] !== line) {
      // oxlint-disable-next-line no-await-in-loop -- one notification at a time
      log = member(await peer.notification(SceneNotification.log), "params");
    }
    expect(isLogParams(log)).toBe(true);
    expect(log).toMatchObject({ level: "warn", scope: null, message: line });

    app.world.createEntity("Bomb").addComponent(Exploder);
    const error = member(await peer.notification(SceneNotification.hostError), "params");
    expect(isHostErrorParams(error)).toBe(true);
    expect(error).toMatchObject({ code: null, message: "Exploder.awake: boom." });
  });
});

/**
 * Tells whether a value is a plain record.
 *
 * @param value - The value.
 * @returns True for an object that is not an array.
 */
function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
