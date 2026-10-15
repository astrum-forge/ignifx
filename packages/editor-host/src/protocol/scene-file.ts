// A copy of `packages/editor-protocol/src/scene-file.ts` from `astrum-forge/ignifx-editor` (protocol 0.3).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * The engine's scene file format as it travels on the wire: the same object `@ignifx/core`'s
 * `serializeScene` builds and `stringifySceneFile` writes
 * (`docs/architecture/06-serialization-and-scene-format.md` §2 in the engine repository).
 *
 * @remarks
 * This package has no dependencies, so it restates the engine's types instead of importing them.
 * Every type here has the engine type's name, fields and literal strings, and the package's tests
 * check that each pair is assignable both ways against the pinned `@ignifx/core`. The guards check
 * the structure a peer relies on, not every rule of the format: the host still validates an opened
 * file with the engine's `validateSceneFile`.
 */
import { isRecord } from "./rpc.js";

/**
 * Any JSON value. The engine's `JsonValue`.
 *
 * @public
 */
export type JsonValue = string | number | boolean | null | JsonArray | JsonObject;

/**
 * A JSON array. The engine's `JsonArray`.
 *
 * @public
 */
export type JsonArray = readonly JsonValue[];

/**
 * A JSON object. The engine's `JsonObject`.
 *
 * @public
 */
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * A serialized asset reference: `{ "$asset": "<address>", "type"?: "<type>" }`. The engine's
 * `SceneFileAssetRef`.
 *
 * @public
 */
export interface SceneFileAssetRef {
  /** The address the asset is registered under. */
  readonly $asset: string;
  /** The asset type name, written only when the address extension does not identify it. */
  readonly type?: string;
}

/**
 * An entity's local transform. The engine's `SceneFileTransform`.
 *
 * @public
 */
export interface SceneFileTransform {
  /** Local position, `[x, y, z]`, in metres. */
  readonly position: readonly [number, number, number];
  /** Local rotation quaternion, `[x, y, z, w]`. */
  readonly rotation: readonly [number, number, number, number];
  /** Local scale, `[x, y, z]`. */
  readonly scale: readonly [number, number, number];
}

/**
 * One component of one entity. The engine's `SceneFileComponent`.
 *
 * @public
 */
export interface SceneFileComponent {
  /** ULID, unique within the file. */
  readonly uid: string;
  /** The component class's registered `typeId`. */
  readonly type: string;
  /** Omitted when `true`, the default. */
  readonly enabled?: boolean;
  /** Written only when the class's `schemaVersion` differs from `1`. */
  readonly schemaVersion?: number;
  /** Values in the component schema's declaration order. */
  readonly props?: JsonObject;
}

/**
 * One override patch applied to an instanced scene. The engine's `SceneFileOverride`.
 *
 * @public
 */
export interface SceneFileOverride {
  /** `"replace"` (the default) patches a value, `"remove"` deletes a component, `"add"` appends one. */
  readonly op?: "replace" | "remove" | "add";
  /** The path into the instanced file, in the engine's override path grammar. */
  readonly path: string;
  /** The new value, for `"replace"` and `"add"`. */
  readonly value?: JsonValue;
}

/**
 * The `instance` entry that makes an entity the root of an instanced scene (a prefab instance).
 * The engine's `SceneFileInstance`.
 *
 * @public
 */
export interface SceneFileInstance {
  /** The scene asset to instance. */
  readonly scene: SceneFileAssetRef;
  /** The content hash of that asset at save time. */
  readonly hash?: string;
  /** The patches applied to the instanced entities, in order. */
  readonly overrides?: readonly SceneFileOverride[];
}

/**
 * One entity of a scene file. The engine's `SceneFileEntity`.
 *
 * @public
 */
export interface SceneFileEntity {
  /** ULID, unique within the file. */
  readonly uid: string;
  /** The display name. */
  readonly name: string;
  /** The parent's uid, or `null` for a root. */
  readonly parent: string | null;
  /** Omitted when `true`, the default. */
  readonly active?: boolean;
  /** Omitted when `false`, the default. */
  readonly static?: boolean;
  /** The layer name, omitted when `"Default"`. */
  readonly layer?: string;
  /** The tags, omitted when empty. */
  readonly tags?: readonly string[];
  /** Always present. */
  readonly transform: SceneFileTransform;
  /** Present only on instance roots. */
  readonly instance?: SceneFileInstance;
  /** The entity's own components; on an instance root, the ones added on top of the instance. */
  readonly components?: readonly SceneFileComponent[];
}

/**
 * A whole scene or prefab file. The engine's `SceneFile`.
 *
 * @public
 */
export interface SceneFile {
  /** Always `"ignifx.scene"`. */
  readonly format: string;
  /** `1` for every file the engine writes before 1.0. */
  readonly formatVersion: number;
  /** The `@ignifx/core` version that wrote the file; informational. */
  readonly engineVersion?: string;
  /** The scene's name. */
  readonly name: string;
  /** Scene-level values interpreted by systems. */
  readonly settings?: JsonObject;
  /** Every entity, in tree order: parents before children, siblings in order. */
  readonly entities: readonly SceneFileEntity[];
}

/** How deep a JSON value may nest before {@link isJsonValue} refuses it, as a guard against cycles. */
const MAX_JSON_DEPTH = 256;

/**
 * Tells whether a value is JSON: `null`, a boolean, a string, a finite number, or an array or
 * plain object of JSON values, nested at most 256 levels deep.
 *
 * @param value - The value to test.
 * @returns True for a JSON value.
 *
 * @public
 */
export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueAt(value, 0);
}

/**
 * {@link isJsonValue} at a nesting depth.
 *
 * @param value - The value to test.
 * @param depth - How deep the value sits.
 * @returns True for a JSON value no deeper than the limit.
 */
function isJsonValueAt(value: unknown, depth: number): value is JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    return false;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item: unknown) => isJsonValueAt(item, depth + 1));
  }
  if (!isRecord(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every((item) => isJsonValueAt(item, depth + 1))
  );
}

/**
 * Tells whether a value is a JSON object.
 *
 * @param value - The value to test.
 * @returns True for a plain object of JSON values.
 *
 * @public
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value);
}

/**
 * Tells whether a value is a uid: a non-empty string, as the scene format's `uid` definition
 * requires. Whether it is a ULID is not the wire's concern.
 *
 * @param value - The value to test.
 * @returns True for a non-empty string.
 *
 * @internal
 */
export function isUidString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Tells whether a value is a finite number.
 *
 * @param value - The value to test.
 * @returns True for a finite number.
 *
 * @internal
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Tells whether a value is an array of finite numbers of one length.
 *
 * @param value - The value to test.
 * @param length - The required length.
 * @returns True for `length` finite numbers.
 *
 * @internal
 */
export function isNumberTuple(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every((item: unknown) => isFiniteNumber(item));
}

/**
 * Tells whether a value is an array whose every item passes a test.
 *
 * @param value - The value to test.
 * @param item - The test for one item.
 * @returns True for an array of passing items.
 *
 * @internal
 */
export function isArrayOf<T>(value: unknown, item: (entry: unknown) => entry is T): value is readonly T[] {
  return Array.isArray(value) && value.every((entry: unknown) => item(entry));
}

/**
 * Tells whether an optional field of a record is absent or passes a test.
 *
 * @param record - The record.
 * @param key - The field.
 * @param test - The test for a present value.
 * @returns True when the field is absent (or `undefined`) or passes.
 *
 * @internal
 */
export function optionalField(
  record: Record<string, unknown>,
  key: string,
  test: (value: unknown) => boolean,
): boolean {
  const value = record[key];
  return value === undefined || test(value);
}

/**
 * Tells whether a value is a string.
 *
 * @param value - The value to test.
 * @returns True for a string.
 *
 * @internal
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Tells whether a value is a boolean.
 *
 * @param value - The value to test.
 * @returns True for a boolean.
 *
 * @internal
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Checks an asset reference.
 *
 * @param value - The value to test.
 * @returns True for `{ $asset: string, type?: string }`.
 *
 * @public
 */
export function isSceneFileAssetRef(value: unknown): value is SceneFileAssetRef {
  return isRecord(value) && isString(value["$asset"]) && optionalField(value, "type", isString);
}

/**
 * Checks a local transform.
 *
 * @param value - The value to test.
 * @returns True for three, four and three finite numbers in `position`, `rotation` and `scale`.
 *
 * @public
 */
export function isSceneFileTransform(value: unknown): value is SceneFileTransform {
  return (
    isRecord(value) &&
    isNumberTuple(value["position"], 3) &&
    isNumberTuple(value["rotation"], 4) &&
    isNumberTuple(value["scale"], 3)
  );
}

/**
 * Checks a component record.
 *
 * @param value - The value to test.
 * @returns True for a record with a uid, a type and well-typed optional fields.
 *
 * @public
 */
export function isSceneFileComponent(value: unknown): value is SceneFileComponent {
  return (
    isRecord(value) &&
    isUidString(value["uid"]) &&
    isString(value["type"]) &&
    optionalField(value, "enabled", isBoolean) &&
    optionalField(value, "schemaVersion", (version) => Number.isSafeInteger(version)) &&
    optionalField(value, "props", isJsonObject)
  );
}

/**
 * Tells whether a value is an override's `op`.
 *
 * @param value - The value to test.
 * @returns True for `"replace"`, `"remove"` or `"add"`.
 *
 * @internal
 */
export function isOverrideOp(value: unknown): value is "replace" | "remove" | "add" {
  return value === "replace" || value === "remove" || value === "add";
}

/**
 * Checks an override patch.
 *
 * @param value - The value to test.
 * @returns True for `{ op?, path, value? }` with a known `op` and a JSON `value`.
 *
 * @public
 */
export function isSceneFileOverride(value: unknown): value is SceneFileOverride {
  return (
    isRecord(value) &&
    isString(value["path"]) &&
    optionalField(value, "op", isOverrideOp) &&
    optionalField(value, "value", (patch) => isJsonValue(patch))
  );
}

/**
 * Checks an `instance` entry.
 *
 * @param value - The value to test.
 * @returns True for `{ scene, hash?, overrides? }`.
 *
 * @public
 */
export function isSceneFileInstance(value: unknown): value is SceneFileInstance {
  return (
    isRecord(value) &&
    isSceneFileAssetRef(value["scene"]) &&
    optionalField(value, "hash", isString) &&
    optionalField(value, "overrides", (overrides) => isArrayOf(overrides, isSceneFileOverride))
  );
}

/**
 * Checks an entity record.
 *
 * @param value - The value to test.
 * @returns True for a record with a uid, a name, a parent, a transform and well-typed optional
 * fields.
 *
 * @public
 */
export function isSceneFileEntity(value: unknown): value is SceneFileEntity {
  if (!isRecord(value)) {
    return false;
  }
  const parent = value["parent"];
  return (
    isUidString(value["uid"]) &&
    isString(value["name"]) &&
    (parent === null || isUidString(parent)) &&
    optionalField(value, "active", isBoolean) &&
    optionalField(value, "static", isBoolean) &&
    optionalField(value, "layer", isString) &&
    optionalField(value, "tags", (tags) => isArrayOf(tags, isString)) &&
    isSceneFileTransform(value["transform"]) &&
    optionalField(value, "instance", isSceneFileInstance) &&
    optionalField(value, "components", (components) => isArrayOf(components, isSceneFileComponent))
  );
}

/**
 * Checks a whole scene file's structure.
 *
 * @param value - The value to test.
 * @returns True for a file object whose header fields and entity records have the right types.
 *
 * @public
 */
export function isSceneFile(value: unknown): value is SceneFile {
  return (
    isRecord(value) &&
    isString(value["format"]) &&
    Number.isSafeInteger(value["formatVersion"]) &&
    optionalField(value, "engineVersion", isString) &&
    isString(value["name"]) &&
    optionalField(value, "settings", isJsonObject) &&
    isArrayOf(value["entities"], isSceneFileEntity)
  );
}
