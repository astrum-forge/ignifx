import { readFileSync } from "node:fs";
import {
  computeSceneHash,
  createApp,
  decodeProps,
  describeSchemas,
  describeSettings,
  encodeProps,
  stringifySceneFile,
  toJsonSchema,
  transformSchema,
} from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEngineVersion } from "../src/host.js";
import { startEditorPlayControls } from "../src/play-controls.js";
import {
  COLLIDER_OUTLINES_MAX_ENTITIES,
  COLLIDER_OUTLINES_MAX_NUMBERS,
  HostCapability,
  isApplyOpsParams,
  isApplyOpsResult,
  isAssetReloadedParams,
  isColliderOutlineSet,
  isEntitySelection,
  isFrameParams,
  isAppErrorData,
  isHostErrorParams,
  isHotReloadedParams,
  isInvalidSceneFileData,
  isLogParams,
  isOpenSceneParams,
  isOpenSceneResult,
  isPickParams,
  isPickResult,
  isPlayStateReport,
  isPlayStats,
  isReadBackParams,
  isReadBackResult,
  isRpcMessage,
  isSampleAnimationParams,
  isSampleAnimationResult,
  isSceneOpenedParams,
  isSchemaSet,
  isScreenshotParams,
  isScreenshotResult,
  isSetAnimateMaterialsParams,
  isSetGizmoParams,
  isSettingsSet,
  isSetViewModeParams,
  isTransformDraggedParams,
  isTransformDraggingParams,
  PlayMethod,
  PlayNotification,
  PROTOCOL_VERSION,
  RpcErrorCode,
  SceneMethod,
  SceneNotification,
} from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import { ENGINE_VERSION } from "./support/engine-version.js";
import { CRATE_PREFAB, Exploder, Health, startLiveHost, Wire } from "./support/scene-project.js";
import type { Received } from "./support/editor.js";
import type { LiveHost } from "./support/scene-project.js";
import type { App, JsonObject, SceneFile, SceneFileEntity } from "@ignifx/core";

/**
 * Wire compatibility with the editor, protocol 0.3. `fixtures/host-0.3-wire.json` is copied
 * unchanged from the editor repository (`packages/editor-protocol/test/fixtures/`), where
 * `wire-0.3.test.ts` checks it against `@ignifx/editor-protocol` 0.3; change it there first.
 * Here every message in it goes through this package's guards, and its requests go through a live
 * headless host, whose answers must be the fixture's: the `game/Health` and `ignifx/Transform`
 * schema entries byte for byte, `allowMultiple` and `package` included, so that the two copies
 * cannot drift apart unnoticed.
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

/** The schema entries the live host must send byte for byte as the fixture has them. */
const WIRE_SCHEMAS: readonly string[] = ["game/Health", "game/Regen", "ignifx/Transform"];

/**
 * Asserts a live schema entry is the fixture's, byte for byte.
 *
 * @param schemas - The host's `schemas`.
 * @param expected - The fixture's `schemas`.
 * @param typeId - The entry to compare.
 */
function expectSchemaWire(schemas: Received, expected: Received, typeId: string): void {
  expectWire(member(schemas, typeId), expected[typeId]);
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
  setAnimateMaterials: isSetAnimateMaterialsParams,
  getColliderOutlines: isEntitySelection,
  sceneOpened: isSceneOpenedParams,
  sceneOpened2d: isSceneOpenedParams,
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
  assetReloaded: isAssetReloadedParams,
  assetReloadedModel: isAssetReloadedParams,
  playStateChanged: isPlayStateReport,
  playStateChangedStopped: isPlayStateReport,
  sampleAnimation: isSampleAnimationParams,
  sampleAnimationBlend: isSampleAnimationParams,
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
  pickMissRay: isPickResult,
  pickMissRay2d: isPickResult,
  pickHit2d: isPickResult,
  screenshotResponse: isScreenshotResult,
  getSchemasResponse: isSchemaSet,
  describeSettingsResponse: isSettingsSet,
  getColliderOutlinesResponse: isColliderOutlineSet,
  playStateResponse: isPlayStateReport,
  playStatsResponse: isPlayStats,
  playStatsStoppedResponse: isPlayStats,
  sampleAnimationResponse: isSampleAnimationResult,
  sampleAnimationLoadingResponse: isSampleAnimationResult,
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
    const names: readonly unknown[] = [
      ...Object.values(SceneMethod),
      ...Object.values(SceneNotification),
      ...Object.values(PlayMethod),
      ...Object.values(PlayNotification),
      "hello",
    ];
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

  it("accepts a schema's requires as type ids or null, and refuses anything else", () => {
    const transform = member(member(member(wire("getSchemasResponse"), "result"), "schemas"), "ignifx/Transform");
    const withRequires = (requires: unknown): unknown => ({ schemas: { "game/Turret": { ...transform, requires } } });
    expect(isSchemaSet(withRequires(["game/Health", null]))).toBe(true);
    expect(isSchemaSet(withRequires("game/Health"))).toBe(false);
    expect(isSchemaSet(withRequires([3]))).toBe(false);
  });

  it("accepts a pick answer with or without its ray, and refuses a malformed ray or plane point", () => {
    const answer = member(wire("pickMissRay"), "result");
    const ray = member(answer, "ray");
    expect(isPickResult(member(wire("pickMiss"), "result"))).toBe(true);
    expect(isPickResult({ ...answer, plane: undefined })).toBe(true);
    expect(isPickResult({ ...answer, ray: { ...ray, origin: [0, 1] } })).toBe(false);
    expect(isPickResult({ ...answer, ray: { origin: ray["origin"] } })).toBe(false);
    expect(isPickResult({ ...answer, ray: null })).toBe(false);
    expect(isPickResult({ ...answer, plane: [1, 2, Number.NaN] })).toBe(false);
  });

  it("accepts an applyOps answer with or without its warnings, and refuses malformed ones", () => {
    const result = member(wire("applyOpsResponse"), "result");
    expect(isApplyOpsResult({ ...result, warnings: undefined })).toBe(true);
    expect(isApplyOpsResult({ ...result, warnings: [] })).toBe(true);
    expect(isApplyOpsResult({ ...result, warnings: [{ code: "IGX-0604" }] })).toBe(false);
    expect(isApplyOpsResult({ ...result, warnings: "IGX-0604" })).toBe(false);
    expect(isApplyOpsResult({ ...result, warnings: null })).toBe(false);
  });

  it("accepts an open answer and sceneOpened with or without a view mode, and refuses an unknown one", () => {
    const result = member(wire("openSceneResponse"), "result");
    const opened = member(wire("sceneOpened2d"), "params");
    expect(result["viewMode"]).toBe("3d");
    expect(opened["viewMode"]).toBe("2d");
    expect(isOpenSceneResult({ ...result, viewMode: undefined })).toBe(true);
    expect(isOpenSceneResult({ ...result, viewMode: "iso" })).toBe(false);
    expect(isSceneOpenedParams({ ...opened, viewMode: undefined })).toBe(true);
    expect(isSceneOpenedParams({ ...opened, viewMode: 2 })).toBe(false);
  });

  it("refuses an assetReloaded without an address, a type, or a list of uids (engine ask E23)", () => {
    const params = member(wire("assetReloaded"), "params");
    expect(isAssetReloadedParams({ ...params, address: "" })).toBe(false);
    expect(isAssetReloadedParams({ ...params, type: undefined })).toBe(false);
    expect(isAssetReloadedParams({ ...params, entities: undefined })).toBe(false);
    expect(isAssetReloadedParams({ ...params, entities: [3] })).toBe(false);
    expect(isAssetReloadedParams({ ...params, entities: [] })).toBe(true);
  });

  it("refuses a play state with an unknown state, a fractional frame count or a negative time (E24)", () => {
    const report = member(wire("playStateResponse"), "result");
    expect(isPlayStateReport(report)).toBe(true);
    expect(isPlayStateReport({ ...report, state: "running" })).toBe(false);
    expect(isPlayStateReport({ ...report, frameCount: 1.5 })).toBe(false);
    expect(isPlayStateReport({ ...report, time: -1 })).toBe(false);
    expect(isPlayStateReport({ ...report, time: Number.NaN })).toBe(false);
    expect(isPlayStateReport({ state: "paused", frameCount: 1 })).toBe(false);
    expect(isPlayStateReport(null)).toBe(false);
  });

  it("refuses play stats with a negative or non-finite rate or a fractional count (E25)", () => {
    const stats = member(wire("playStatsResponse"), "result");
    expect(isPlayStats(stats)).toBe(true);
    expect(isPlayStats({ ...stats, fps: -1 })).toBe(false);
    expect(isPlayStats({ ...stats, frameTimeMs: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isPlayStats({ ...stats, entityCount: 1.5 })).toBe(false);
    expect(isPlayStats({ ...stats, frameCount: -1 })).toBe(false);
    expect(isPlayStats({ fps: 60, frameTimeMs: 16.67, entityCount: 3 })).toBe(false);
    expect(isPlayStats(null)).toBe(false);
  });

  it("refuses settings whose sections are not schema descriptions or whose values are not objects", () => {
    const result = member(wire("describeSettingsResponse"), "result");
    const sections = member(result, "sections");
    expect(isSettingsSet({ ...result, values: { ...member(result, "values"), time: 1 } })).toBe(false);
    expect(isSettingsSet({ ...result, sections: { ...sections, time: { title: "time" } } })).toBe(false);
    expect(isSettingsSet({ sections })).toBe(false);
    expect(isSettingsSet({ sections: {}, values: {} })).toBe(true);
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

    // A headless host lists only `heartbeat`, `logRelay` and `hotReloadDefaults`: it draws no
    // gizmos, captures nothing, has no 2D view. The fixture records the engine version the editor's
    // copy was made at; the host reports the one it runs, so that field is the live one on both sides.
    const ready = wire("readyScene");
    const capabilities = [HostCapability.heartbeat, HostCapability.logRelay, HostCapability.hotReloadDefaults];
    const engineVersion = resolveEngineVersion(ENGINE_VERSION);
    expectWire(await peer.request(wire("hello")), {
      ...ready,
      result: { ...member(ready, "result"), engineVersion, capabilities },
    });
    expect(member(member(ready, "result"), "protocol")).toEqual(PROTOCOL_VERSION);

    expectWire(await peer.request(wire("openSceneBeforeStart")), wire("notReadyScene"));

    live.release();
    const host = await live.host;
    const schemas = member(await peer.notification(SceneNotification.schemasChanged), "params");
    expect(isSchemaSet(schemas)).toBe(true);
    const expected = member(member(wire("schemasChangedAtStart"), "params"), "schemas");
    const actual = member(schemas, "schemas");
    for (const typeId of WIRE_SCHEMAS) {
      expectSchemaWire(actual, expected, typeId);
    }
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
    for (const typeId of WIRE_SCHEMAS) {
      expectSchemaWire(actual, expected, typeId);
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
    // The fixture's level has a 3D camera and the project no 2D toolkit: a 3D scene.
    expect(result["viewMode"]).toBe(member(response, "result")["viewMode"]);
    expectWire(opened, { ...response, result });
    const sceneOpened = wire("sceneOpened");
    expectWire(await peer.notification(SceneNotification.sceneOpened), {
      ...sceneOpened,
      params: { ...member(sceneOpened, "params"), warnings: result["warnings"] },
    });

    // The instantiated crate carries the same made-up hash: the same IGX-0604, in the same words,
    // in the answer's warnings (and as a log line).
    const applied = await peer.request(wire("applyOps"));
    const appliedResponse = wire("applyOpsResponse");
    const appliedResult = member(appliedResponse, "result");
    const appliedWarnings = member(applied, "result")["warnings"];
    expect(appliedWarnings).toEqual(warnings);
    expect([appliedResult["warnings"]].flat()).toMatchObject([{ code: "IGX-0604" }]);
    expectWire(applied, { ...appliedResponse, result: { ...appliedResult, warnings: appliedWarnings } });

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

  it("answers describeSettings with every registered section and the values the app resolved", async () => {
    const { app, peer } = await started();
    const answer = await peer.request(wire("describeSettings"));
    const result = member(answer, "result");
    expect(isSettingsSet(result)).toBe(true);
    const expected = member(wire("describeSettingsResponse"), "result");
    const sections = member(result, "sections");
    const values = member(result, "values");
    expect(Object.keys(sections)).toEqual(Object.keys(describeSettings(app)));
    expect(Object.keys(values)).toEqual(Object.keys(sections));
    // The fixture carries two of core's sections; the live host must send them byte for byte.
    for (const name of ["layers", "time"]) {
      expectWire(member(sections, name), member(expected, "sections")[name]);
      expectWire(member(values, name), member(expected, "values")[name]);
    }
    expect(member(values, "rendering")["clearColor"]).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(answer["id"]).toBe(wire("describeSettingsResponse")["id"]);
  });

  it("turns the scene view's material animation off and on with setAnimateMaterials", async () => {
    const { app, peer } = await started();
    expect(app.renderer.animateMaterialsInEditMode).toBe(true);
    expectWire(await peer.request(wire("setAnimateMaterials")), {
      ...wire("nullResponse"),
      id: wire("setAnimateMaterials")["id"],
    });
    expect(app.renderer.animateMaterialsInEditMode).toBe(false);
    await peer.request({ ...wire("setAnimateMaterials"), params: { enabled: true } });
    expect(app.renderer.animateMaterialsInEditMode).toBe(true);
    const refused = await peer.request({ ...wire("setAnimateMaterials"), params: { enabled: "no" } });
    expect(member(refused, "error")["code"]).toBe(RpcErrorCode.invalidParams);
  });

  it("answers getColliderOutlines from the project's physics services, as the fixture has it", async () => {
    const { app, peer } = await started();
    const request = wire("getColliderOutlines");
    expect(member(await peer.request(request), "error")["code"]).toBe(RpcErrorCode.noScene);
    await peer.request(wire("openScene"));
    // A project without a physics extension has nothing to outline.
    expectWire(await peer.request(request), {
      jsonrpc: "2.0",
      id: request["id"],
      result: { outlines: [], truncated: false },
    });

    // Stand-ins for `app.physics` and `app.physics2d`, which the host reads by shape. The collider is
    // a document component with the fixture's uid.
    const expected = member(wire("getColliderOutlinesResponse"), "result");
    const [record] = expected["outlines"] as readonly Received[];
    const crateUid = String(record?.["entity"]);
    const colliderUid = String(record?.["component"]);
    await peer.request({
      jsonrpc: "2.0",
      id: 42,
      method: "applyOps",
      params: {
        ops: [
          { op: "addComponent", entity: crateUid, component: { uid: colliderUid, type: "game/Health", props: {} } },
        ],
        commandName: "Add a collider",
        commandId: "cmd-collider",
      },
    });
    const crate = app.world.findByName("Crate");
    const collider = crate?.components.find((component) => component.uid === colliderUid);
    expect(collider).toBeDefined();
    const lines = new Float32Array(record?.["lines"] as readonly number[]);
    Object.defineProperty(app, "physics", {
      configurable: true,
      value: {
        colliderOutlines: (entity: unknown) => (entity === crate ? [{ collider, isTrigger: false, lines }] : []),
      },
    });
    expectWire(
      await peer.request({ ...request, params: { entities: [crateUid, "nope", crateUid] } }),
      wire("getColliderOutlinesResponse"),
    );

    // A 2D outline's x, y pairs arrive at the entity's world z, rounded to a hundredth of a millimetre.
    Object.defineProperty(app, "physics2d", {
      configurable: true,
      value: {
        colliderOutlines: (entity: unknown) =>
          entity === crate ? [{ collider, isTrigger: true, lines: new Float32Array([0, 0, 1, 0.1]) }] : [],
      },
    });
    const both = member(await peer.request(request), "result");
    expect(both).toEqual({
      outlines: [record, { entity: crateUid, component: colliderUid, isTrigger: true, lines: [0, 0, 4, 1, 0.1, 4] }],
      truncated: false,
    });

    // Past the caps, whole outlines are left out and the answer says so.
    const many = Array.from(
      { length: COLLIDER_OUTLINES_MAX_ENTITIES },
      (_, index) => `01M4ZEB9E0GG0Q6R22YX${String(index).padStart(6, "0")}`,
    );
    const tooMany = member(await peer.request({ ...request, params: { entities: [...many, crateUid] } }), "result");
    expect(tooMany).toEqual({ outlines: [], truncated: true });
    const huge = new Float32Array(COLLIDER_OUTLINES_MAX_NUMBERS - 6);
    Object.defineProperty(app, "physics", {
      configurable: true,
      value: {
        colliderOutlines: (entity: unknown) =>
          entity === crate
            ? [
                { collider, isTrigger: false, lines: huge },
                { collider, isTrigger: false, lines },
              ]
            : [],
      },
    });
    const capped = member(await peer.request(request), "result");
    expect(capped["truncated"]).toBe(true);
    expect((capped["outlines"] as readonly Received[]).map((outline) => (outline["lines"] as number[]).length)).toEqual(
      [COLLIDER_OUTLINES_MAX_NUMBERS - 6],
    );
  });

  it("misses every pick on a headless view, in either unit", async () => {
    const { peer } = await started();
    await peer.request(wire("openScene"));
    expectWire(await peer.request({ ...wire("pick"), id: wire("pickMiss")["id"] }), wire("pickMiss"));
    expectWire(await peer.request(wire("pickBacking")), wire("pickMiss"));
  });

  it("reloads a changed prefab in place and announces it as the fixture's assetReloaded (E23)", async () => {
    const { app, peer } = await started();
    const host = await (live?.host ?? Promise.reject(new Error("No live host.")));
    await peer.request(wire("openScene"));
    await peer.notification(SceneNotification.sceneOpened);
    const crate = "01M4ZEB9E0GG0Q6R22YXV3AVKA";
    const before = app.world.getEntity(crate);
    const readCrate = async (id: number): Promise<unknown> => {
      const read = member(await peer.request({ ...wire("readBack"), id, params: { entities: [crate] } }), "result");
      return [read["entities"]].flat()[0];
    };
    const recordBefore = await readCrate(60);

    const prefab = {
      ...CRATE_PREFAB,
      entities: [
        ...CRATE_PREFAB.entities,
        {
          uid: "01M4XQ7K3N8V2D5R0B6G1HT9WW",
          name: "Handle",
          parent: "01M4XQ7K3N8V2D5R0B6G1HT9WS",
          transform: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        },
      ],
    } satisfies SceneFile;
    live?.setFile("prefabs/crate.prefab.json", stringifySceneFile(prefab));
    const reloaded = host.assetChanged({ address: "prefabs/crate.prefab.json", kind: "changed" });

    expectWire(await peer.notification(SceneNotification.assetReloaded), wire("assetReloaded"));
    expect(await reloaded).toBe(true);
    const after = app.world.getEntity(crate);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after?.children.map((child) => child.name)).toEqual(expect.arrayContaining(["Lid", "Base", "Handle"]));
    // The record is the one the editor holds, transform and overrides included, at the new hash.
    const record = await readCrate(61);
    expect(isRecord(record) ? member(record, "instance")["hash"] : null).toBe(await computeSceneHash(prefab));
    expect(maskHashes([record])).toEqual(maskHashes([recordBefore]));
  });

  it("leaves a texture, a removed file and an asset it never loaded alone (E23)", async () => {
    const { peer } = await started();
    const host = await (live?.host ?? Promise.reject(new Error("No live host.")));
    await peer.request(wire("openScene"));
    expect(await host.assetChanged({ address: "prefabs/crate.prefab.json", kind: "removed" })).toBe(false);
    expect(await host.assetChanged({ address: "textures/unused.png", kind: "changed" })).toBe(false);
    expect(await host.assetChanged({ address: "scenes/level01.scene.json", kind: "changed" })).toBe(false);
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
    // Where it was caught (`HostCapability.logRelay`): the entity, the component, the stack.
    const data = member(error, "data");
    expect(isAppErrorData(data)).toBe(true);
    expect(data).toMatchObject({ source: "lifecycle", entityName: "Bomb", component: "game/Exploder" });
    expect(data["stack"]).toEqual(expect.stringContaining("Exploder.awake: boom."));
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

describe("the editor's 0.3 wire fixture, through live play controls", () => {
  it("answers playState and reports each change, after the answer to the method that made it (E24)", async () => {
    const app = await createApp({ headless: true });
    const target = new EventTarget();
    const controls = startEditorPlayControls(app, {
      editorOrigin: EDITOR_ORIGIN,
      messageTarget: target,
      heartbeatIntervalMs: 60_000,
    });
    const peer = new Wire(connect(target));
    try {
      await peer.request(wire("hello"));

      // The 0.2 fixture's step with a delta: one frame of 0.02 s, then paused on it.
      const step = { jsonrpc: "2.0", id: 23, method: PlayMethod.step, params: { deltaSeconds: 0.02 } };
      await peer.request(step);
      // The game's log lines (`HostCapability.logRelay`) may come first; no state change does.
      expect(peer.notifications.filter((message) => message["method"] === PlayNotification.playStateChanged)).toEqual(
        [],
      );
      expectWire(await peer.notification(PlayNotification.playStateChanged), wire("playStateChanged"));

      expectWire(await peer.request(wire("playState")), wire("playStateResponse"));

      await peer.request({ jsonrpc: "2.0", id: 25, method: PlayMethod.stop });
      expectWire(await peer.notification(PlayNotification.playStateChanged), wire("playStateChangedStopped"));

      // Stopped on its one frame, with three entities: no rate, the world's count (E25).
      for (const name of ["Player", "Crate", "Sun"]) {
        app.world.createEntity(name);
      }
      expectWire(await peer.request(wire("playStats")), wire("playStatsStoppedResponse"));
    } finally {
      peer.close();
      controls.dispose();
      app.dispose();
    }
  });
});
