import { isMemoryAddress } from "../assets/address.js";
import { assertNever } from "../errors/ignifx-error.js";
import {
  COLOR_CHANNELS,
  VECTOR_COMPONENTS,
  asFieldValue,
  childPath,
  indexPath,
  isArray,
  isPlainObject,
} from "./internal.js";
import { SchemaIssueCode, issue } from "./issues.js";
import type { SchemaIssue } from "./issues.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { FieldDefinition, FieldsOf, PartialFieldsOf, Schema } from "./types.js";

/**
 * How the serializer turns a live entity or component reference into the uid written to a file.
 * Reference kinds cannot be encoded without a world, so the kernel implements this and tests pass
 * a fake.
 *
 * @public
 */
export interface ReferenceEncoder {
  /**
   * Resolves an entity reference to its file-local uid.
   *
   * @param value - The entity the field points at.
   * @returns The uid, or `null` when the target is not part of the file being written.
   */
  entityUid(value: unknown): string | null;
  /**
   * Resolves a component reference to its file-local uid.
   *
   * @param value - The component the field points at.
   * @returns The uid, or `null` when the target is not part of the file being written.
   */
  componentUid(value: unknown): string | null;
}

/**
 * How the loader turns a uid read from a file back into a live entity or component.
 *
 * @public
 */
export interface ReferenceDecoder {
  /**
   * Looks up an entity by its file-local uid.
   *
   * @param uid - The uid read from the file.
   * @returns The entity, or `null` when the uid is unknown.
   */
  entity(uid: string): unknown;
  /**
   * Looks up a component by its file-local uid.
   *
   * @param uid - The uid read from the file.
   * @returns The component, or `null` when the uid is unknown.
   */
  component(uid: string): unknown;
  /**
   * Resolves an asset address to the loaded handle an `asset()` field should hold
   * (`docs/architecture/05-assets-and-loading.md` §3).
   *
   * @remarks
   * The scene loader answers from the dependency handles the `SceneAsset` already retains, so the
   * field never starts a load of its own and never owns a reference count. A resolver that returns
   * `null` — an address nothing loaded — makes the field `null` and adds an `IGX-0602` issue.
   *
   * @param address - The address the file carries, fragment included.
   * @param type - The asset type the field or the file declared, or `null` when the address's
   * extension identifies it on its own.
   * @returns The handle, or `null` when nothing loaded stands at that address.
   */
  asset(address: string, type: string | null): unknown;
}

/**
 * What decoding produced: a value that is always usable — the field's default when the JSON could
 * not be read — plus every problem found on the way.
 *
 * @typeParam T - The decoded value type.
 *
 * @public
 */
export interface DecodeResult<T> {
  /** The decoded value, or the field's freshly built default when decoding failed. */
  readonly value: T;
  /** Every problem found, in discovery order; empty on a clean decode. */
  readonly issues: readonly SchemaIssue[];
}

/**
 * Rounds a number to the file format's precision: six decimal places, with `-0` normalized to `0`
 * (`docs/architecture/06-serialization-and-scene-format.md` §3). The rule is idempotent, so
 * save → load → save is byte-identical.
 *
 * @param value - The number to canonicalize.
 * @returns The canonical form of the number.
 *
 * @example
 * ```ts
 * canonicalizeNumber(0.1 + 0.2); // 0.3
 * canonicalizeNumber(-0); // 0
 * ```
 *
 * @public
 */
export function canonicalizeNumber(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Reports a value that does not match its field and yields the JSON stand-in for it.
 *
 * @param issues - The collector to append to.
 * @param path - The property path the problem was found at.
 * @param message - An actionable description.
 * @returns `null`, the placeholder written for an unrepresentable value.
 *
 * @internal
 */
function unrepresentable(issues: SchemaIssue[], path: string, message: string): null {
  issues.push(issue(SchemaIssueCode.typeMismatch, path, message));
  return null;
}

/**
 * Encodes one number, reporting `NaN` and the infinities.
 *
 * @param value - The candidate number.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 * @returns The canonical number, or `null` when it cannot be written.
 *
 * @internal
 */
function encodeNumber(value: unknown, path: string, issues: SchemaIssue[]): JsonValue {
  if (typeof value !== "number") {
    return unrepresentable(issues, path, `expected a number, received ${typeof value}.`);
  }
  if (!Number.isFinite(value)) {
    issues.push(issue(SchemaIssueCode.nonFiniteNumber, path, `${String(value)} cannot be written to JSON.`));
    return null;
  }
  return canonicalizeNumber(value);
}

/**
 * Encodes the named channels of an object value as a JSON number array.
 *
 * @param names - The channel names to read, in encoded order.
 * @param label - How the value is named in messages.
 * @param value - The candidate value.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 * @returns The number array, or `null` when a channel is missing or unrepresentable.
 *
 * @internal
 */
function encodeChannels(
  names: readonly string[],
  label: string,
  value: unknown,
  path: string,
  issues: SchemaIssue[],
): JsonValue {
  if (!isPlainObject(value)) {
    return unrepresentable(issues, path, `expected a ${label} object, received ${typeof value}.`);
  }
  const encoded: JsonValue[] = [];
  for (const name of names) {
    const channel = encodeNumber(value[name], childPath(path, name), issues);
    if (channel === null) {
      return null;
    }
    encoded.push(channel);
  }
  return encoded;
}

/**
 * Encodes one value against one field definition.
 *
 * @param field - The field to encode against.
 * @param value - The value to encode.
 * @param references - How to resolve entity and component references to uids.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 * @returns The JSON representation.
 *
 * @internal
 */
function encodeInto(
  field: FieldDefinition<unknown>,
  value: unknown,
  references: ReferenceEncoder,
  path: string,
  issues: SchemaIssue[],
): JsonValue {
  const { spec } = field;
  switch (spec.kind) {
    case "f32":
    case "f64":
    case "i32":
    case "u32": {
      return encodeNumber(value, path, issues);
    }
    case "bool": {
      return typeof value === "boolean"
        ? value
        : unrepresentable(issues, path, `expected a boolean, received ${typeof value}.`);
    }
    case "str": {
      return typeof value === "string"
        ? value
        : unrepresentable(issues, path, `expected a string, received ${typeof value}.`);
    }
    case "vec2":
    case "vec3":
    case "vec4":
    case "quat": {
      return encodeChannels(VECTOR_COMPONENTS.slice(0, spec.components), spec.kind, value, path, issues);
    }
    case "color": {
      return encodeChannels(COLOR_CHANNELS, "color", value, path, issues);
    }
    case "enum": {
      return typeof value === "string"
        ? value
        : unrepresentable(issues, path, `expected a string, received ${typeof value}.`);
    }
    case "entityRef": {
      if (value === null) {
        return null;
      }
      const uid = references.entityUid(value);
      if (uid === null) {
        issues.push(issue(SchemaIssueCode.unresolvedReference, path, `the referenced entity is not in this file.`));
        return null;
      }
      return { $entity: uid };
    }
    case "componentRef": {
      if (value === null) {
        return null;
      }
      const uid = references.componentUid(value);
      if (uid === null) {
        issues.push(issue(SchemaIssueCode.unresolvedReference, path, `the referenced component is not in this file.`));
        return null;
      }
      return { $component: uid };
    }
    case "asset": {
      if (value === null) {
        return null;
      }
      if (!isPlainObject(value) || typeof value["address"] !== "string") {
        return unrepresentable(issues, path, `expected a loaded asset handle, or null.`);
      }
      const address = value["address"];
      if (isMemoryAddress(address)) {
        // An in-code asset (`Assets.register`, `MeshAsset.box`, `MaterialAsset.pbr`) names no file,
        // so there is nothing a reader could resolve the address against. Writing it would produce
        // a file that loads with a dangling reference; writing `null` and saying so does not.
        issues.push(
          issue(
            SchemaIssueCode.unresolvedReference,
            path,
            `the asset was created in code (${address}) and has no file to reference.`,
          ),
        );
        return null;
      }
      const declared = value["type"];
      const typeName = typeof declared === "string" ? declared : spec.typeName;
      return typeName === null ? { $asset: address } : { $asset: address, type: typeName };
    }
    case "array": {
      if (!isArray(value)) {
        return unrepresentable(issues, path, `expected an array, received ${typeof value}.`);
      }
      const encoded: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        encoded.push(encodeInto(spec.item, value[index], references, indexPath(path, index), issues));
      }
      return encoded;
    }
    case "record": {
      if (!isPlainObject(value)) {
        return unrepresentable(issues, path, `expected an object, received ${typeof value}.`);
      }
      return encodeFields(spec.fields, value, references, path, issues);
    }
    case "map": {
      if (!isPlainObject(value)) {
        return unrepresentable(issues, path, `expected an object, received ${typeof value}.`);
      }
      const encoded: Record<string, JsonValue> = {};
      for (const key of Object.keys(value).toSorted()) {
        encoded[key] = encodeInto(spec.value, value[key], references, indexPath(path, key), issues);
      }
      return encoded;
    }
    case "optional": {
      return value === null ? null : encodeInto(spec.inner, value, references, path, issues);
    }
    case "layerMask": {
      if (!isArray(value)) {
        return unrepresentable(issues, path, `expected an array of layer names.`);
      }
      const encoded: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const name = value[index];
        if (typeof name !== "string") {
          return unrepresentable(issues, indexPath(path, index), `expected a layer name string.`);
        }
        encoded.push(name);
      }
      return encoded;
    }
    case "curve": {
      if (!isPlainObject(value)) {
        return unrepresentable(issues, path, `expected a curve object.`);
      }
      const keys = value["keys"];
      const keysAt = childPath(path, "keys");
      if (!isArray(keys)) {
        return unrepresentable(issues, keysAt, `expected an array of curve keys.`);
      }
      const encoded: JsonValue[] = [];
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const keyAt = indexPath(keysAt, index);
        if (!isArray(key) || key.length !== 4) {
          return unrepresentable(issues, keyAt, `expected [time, value, inTangent, outTangent].`);
        }
        encoded.push([
          encodeNumber(key[0], indexPath(keyAt, 0), issues),
          encodeNumber(key[1], indexPath(keyAt, 1), issues),
          encodeNumber(key[2], indexPath(keyAt, 2), issues),
          encodeNumber(key[3], indexPath(keyAt, 3), issues),
        ]);
      }
      return { keys: encoded };
    }
    case "custom": {
      return spec.codec.serialize(value);
    }
    default: {
      return assertNever(spec, "schema field kind");
    }
  }
}

/**
 * Encodes a bag of values against a schema in canonical (declaration) key order, skipping fields
 * marked `transient` (`docs/architecture/06-serialization-and-scene-format.md` §5).
 *
 * @param schema - The schema that fixes the key order.
 * @param values - The values to encode, keyed by field name; missing names take the field default.
 * @param references - How to resolve entity and component references to uids.
 * @param path - The property path prefix for reported issues.
 * @param issues - The collector to append to.
 * @returns The JSON object.
 *
 * @internal
 */
function encodeFields(
  schema: Schema,
  values: Readonly<Record<string, unknown>>,
  references: ReferenceEncoder,
  path: string,
  issues: SchemaIssue[],
): JsonObject {
  const encoded: Record<string, JsonValue> = {};
  for (const [name, field] of Object.entries(schema)) {
    if (field.options.transient === true) {
      continue;
    }
    const supplied = values[name];
    const value = supplied === undefined ? field.createDefault() : supplied;
    encoded[name] = encodeInto(field, value, references, childPath(path, name), issues);
  }
  return encoded;
}

/**
 * Encodes one value into the JSON form the scene format defines
 * (`docs/architecture/06-serialization-and-scene-format.md` §3). Numbers are canonicalized,
 * vectors and colors become arrays, and references become tagged objects.
 *
 * Encoding is total: it always returns valid JSON. A value that cannot be represented — a `NaN`, a
 * reference to something outside the file, a value of the wrong type — is written as `null` and
 * reported through `issues`. Call {@link validateValue} when you want the check without the output.
 *
 * @typeParam T - The field's value type.
 * @param field - The field to encode against.
 * @param value - The value to encode.
 * @param references - How to resolve entity and component references to uids.
 * @param issues - An optional collector; problems are appended to it in discovery order.
 * @returns The JSON representation.
 *
 * @example
 * ```ts
 * encodeValue(vec3(), { x: 1, y: 2.0000004, z: -0 }, references); // [1, 2, 0]
 * ```
 *
 * @public
 */
export function encodeValue<T>(
  field: FieldDefinition<T>,
  value: T,
  references: ReferenceEncoder,
  issues: SchemaIssue[] = [],
): JsonValue {
  return encodeInto(field, value, references, "", issues);
}

/**
 * Encodes a component's props in canonical key order. Fields the schema declares but `props` omits
 * take their default; fields marked `transient` are skipped.
 *
 * @typeParam S - The schema being encoded.
 * @param schema - The schema that fixes the key order.
 * @param props - The values to encode, keyed by field name.
 * @param references - How to resolve entity and component references to uids.
 * @param issues - An optional collector; problems are appended to it in discovery order.
 * @returns The JSON object written under `props` in a scene file.
 *
 * @public
 */
export function encodeProps<S extends Schema>(
  schema: S,
  props: PartialFieldsOf<S>,
  references: ReferenceEncoder,
  issues: SchemaIssue[] = [],
): JsonObject {
  return encodeFields(schema, asFieldValue<Record<string, unknown>>(props), references, "", issues);
}

/**
 * Decodes one JSON value against one field definition.
 *
 * @param field - The field to decode against.
 * @param json - The JSON to read.
 * @param references - How to resolve uids back to entities and components.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 * @returns The decoded value, or the field's fresh default when the JSON could not be read.
 *
 * @internal
 */
function decodeInto(
  field: FieldDefinition<unknown>,
  json: JsonValue,
  references: ReferenceDecoder,
  path: string,
  issues: SchemaIssue[],
): unknown {
  const { spec } = field;
  switch (spec.kind) {
    case "f32":
    case "f64":
    case "i32":
    case "u32": {
      if (typeof json !== "number" || !Number.isFinite(json)) {
        return rejected(field, issues, path, `expected a finite number.`);
      }
      return canonicalizeNumber(json);
    }
    case "bool": {
      return typeof json === "boolean" ? json : rejected(field, issues, path, `expected a boolean.`);
    }
    case "str": {
      return typeof json === "string" ? json : rejected(field, issues, path, `expected a string.`);
    }
    case "vec2":
    case "vec3":
    case "vec4":
    case "quat": {
      return decodeChannels(VECTOR_COMPONENTS.slice(0, spec.components), field, json, path, issues);
    }
    case "color": {
      return decodeChannels(COLOR_CHANNELS, field, json, path, issues);
    }
    case "enum": {
      if (typeof json !== "string" || !spec.values.includes(json)) {
        return rejected(field, issues, path, `expected one of [${spec.values.join(", ")}].`);
      }
      return json;
    }
    case "entityRef": {
      return decodeReference(field, json, "$entity", (uid) => references.entity(uid), path, issues);
    }
    case "componentRef": {
      return decodeReference(field, json, "$component", (uid) => references.component(uid), path, issues);
    }
    case "asset": {
      if (json === null) {
        return null;
      }
      if (!isPlainObject(json) || typeof json["$asset"] !== "string") {
        return rejected(field, issues, path, `expected { "$asset": "<address>" } or null.`);
      }
      const address = json["$asset"];
      const declared = json["type"];
      const typeName = typeof declared === "string" ? declared : spec.typeName;
      const handle = references.asset(address, typeName);
      if (handle === null || handle === undefined) {
        issues.push(
          issue(SchemaIssueCode.unresolvedReference, path, `no loaded asset stands at the address "${address}".`),
        );
        return null;
      }
      return handle;
    }
    case "array": {
      if (!isArray(json)) {
        return rejected(field, issues, path, `expected an array.`);
      }
      const decoded: unknown[] = [];
      for (let index = 0; index < json.length; index += 1) {
        decoded.push(decodeInto(spec.item, json[index] ?? null, references, indexPath(path, index), issues));
      }
      return decoded;
    }
    case "record": {
      if (!isPlainObject(json)) {
        return rejected(field, issues, path, `expected an object.`);
      }
      return decodeFields(spec.fields, json, references, path, issues);
    }
    case "map": {
      if (!isPlainObject(json)) {
        return rejected(field, issues, path, `expected an object.`);
      }
      const decoded: Record<string, unknown> = {};
      for (const key of Object.keys(json).toSorted()) {
        decoded[key] = decodeInto(spec.value, json[key] ?? null, references, indexPath(path, key), issues);
      }
      return decoded;
    }
    case "optional": {
      return json === null ? null : decodeInto(spec.inner, json, references, path, issues);
    }
    case "layerMask": {
      if (!isArray(json)) {
        return rejected(field, issues, path, `expected an array of layer names.`);
      }
      const names: string[] = [];
      for (let index = 0; index < json.length; index += 1) {
        const name = json[index];
        if (typeof name !== "string") {
          return rejected(field, issues, indexPath(path, index), `expected a layer name string.`);
        }
        names.push(name);
      }
      return names;
    }
    case "curve": {
      if (!isPlainObject(json)) {
        return rejected(field, issues, path, `expected a curve object.`);
      }
      const keysAt = childPath(path, "keys");
      const rawKeys = json["keys"];
      if (!isArray(rawKeys)) {
        return rejected(field, issues, keysAt, `expected an array of curve keys.`);
      }
      const keys: (readonly [number, number, number, number])[] = [];
      for (let index = 0; index < rawKeys.length; index += 1) {
        const key = rawKeys[index];
        if (!isArray(key) || key.length !== 4) {
          return rejected(field, issues, indexPath(keysAt, index), `expected [time, value, inTangent, outTangent].`);
        }
        const at = (slot: number): number => {
          const component = key[slot];
          return typeof component === "number" && Number.isFinite(component) ? canonicalizeNumber(component) : 0;
        };
        keys.push([at(0), at(1), at(2), at(3)]);
      }
      return { keys };
    }
    case "custom": {
      return spec.codec.deserialize(json);
    }
    default: {
      return assertNever(spec, "schema field kind");
    }
  }
}

/**
 * Reports unreadable JSON and yields the field's fresh default in its place.
 *
 * @param field - The field being decoded.
 * @param issues - The collector to append to.
 * @param path - The property path the problem was found at.
 * @param message - An actionable description.
 * @returns A newly built default value.
 *
 * @internal
 */
function rejected(field: FieldDefinition<unknown>, issues: SchemaIssue[], path: string, message: string): unknown {
  issues.push(issue(SchemaIssueCode.typeMismatch, path, message));
  return field.createDefault();
}

/**
 * Decodes a JSON number array back into a channel object.
 *
 * @param names - The channel names to write, in encoded order.
 * @param field - The field being decoded, used for its default on failure.
 * @param json - The JSON to read.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 * @returns The channel object, or the field's default.
 *
 * @internal
 */
function decodeChannels(
  names: readonly string[],
  field: FieldDefinition<unknown>,
  json: JsonValue,
  path: string,
  issues: SchemaIssue[],
): unknown {
  if (!isArray(json) || json.length !== names.length) {
    return rejected(field, issues, path, `expected an array of ${names.length} numbers.`);
  }
  const decoded: Record<string, number> = {};
  for (let index = 0; index < names.length; index += 1) {
    const component = json[index];
    const name = names[index];
    if (typeof component !== "number" || !Number.isFinite(component) || name === undefined) {
      return rejected(field, issues, indexPath(path, index), `expected a finite number.`);
    }
    decoded[name] = canonicalizeNumber(component);
  }
  return decoded;
}

/**
 * Decodes a tagged reference object back into a live target.
 *
 * @param field - The field being decoded, used for its default on failure.
 * @param json - The JSON to read.
 * @param tag - The tag property, `$entity` or `$component`.
 * @param resolve - How to turn a uid into a target.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 * @returns The resolved target, or `null`.
 *
 * @internal
 */
function decodeReference(
  field: FieldDefinition<unknown>,
  json: JsonValue,
  tag: "$entity" | "$component",
  resolve: (uid: string) => unknown,
  path: string,
  issues: SchemaIssue[],
): unknown {
  if (json === null) {
    return null;
  }
  if (!isPlainObject(json) || typeof json[tag] !== "string") {
    return rejected(field, issues, path, `expected { "${tag}": "<uid>" } or null.`);
  }
  const uid = json[tag];
  const target = resolve(uid);
  if (target === null || target === undefined) {
    issues.push(issue(SchemaIssueCode.unresolvedReference, path, `no target in this file has uid "${uid}".`));
    return null;
  }
  return target;
}

/**
 * Decodes a JSON object against a schema, filling omitted fields with their defaults.
 *
 * @param schema - The schema to decode against.
 * @param json - The JSON object to read.
 * @param references - How to resolve uids back to entities and components.
 * @param path - The property path prefix for reported issues.
 * @param issues - The collector to append to.
 * @returns A record holding one value per declared field.
 *
 * @internal
 */
function decodeFields(
  schema: Schema,
  json: JsonObject,
  references: ReferenceDecoder,
  path: string,
  issues: SchemaIssue[],
): Record<string, unknown> {
  for (const name of Object.keys(json)) {
    if (!Object.hasOwn(schema, name)) {
      issues.push(
        issue(SchemaIssueCode.unknownField, childPath(path, name), `the schema declares no field "${name}".`),
      );
    }
  }
  const decoded: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema)) {
    const raw = json[name];
    decoded[name] =
      raw === undefined ? field.createDefault() : decodeInto(field, raw, references, childPath(path, name), issues);
  }
  return decoded;
}

/**
 * Decodes one JSON value back into a field value. Decoding never throws and never returns a broken
 * value: unreadable JSON yields the field's freshly built default plus an issue, so a corrupt file
 * degrades one field rather than failing a whole scene
 * (`docs/architecture/06-serialization-and-scene-format.md` §4).
 *
 * @typeParam T - The field's value type.
 * @param field - The field to decode against.
 * @param json - The JSON to read.
 * @param references - How to resolve uids back to entities and components.
 * @returns The decoded value and every problem found.
 *
 * @example
 * ```ts
 * decodeValue(vec3(), [1, 2, 3], references); // { value: { x: 1, y: 2, z: 3 }, issues: [] }
 * ```
 *
 * @public
 */
export function decodeValue<T>(
  field: FieldDefinition<T>,
  json: JsonValue,
  references: ReferenceDecoder,
): DecodeResult<T> {
  const issues: SchemaIssue[] = [];
  const value = decodeInto(field, json, references, "", issues);
  return { value: asFieldValue<T>(value), issues };
}

/**
 * Decodes a component's `props` object. Fields the file omits take their schema default; names the
 * schema does not declare are reported as `IGX-0607` and ignored.
 *
 * @typeParam S - The schema being decoded.
 * @param schema - The schema to decode against.
 * @param json - The `props` object read from the file.
 * @param references - How to resolve uids back to entities and components.
 * @returns The decoded field object and every problem found.
 *
 * @public
 */
export function decodeProps<S extends Schema>(
  schema: S,
  json: JsonObject,
  references: ReferenceDecoder,
): DecodeResult<FieldsOf<S>> {
  const issues: SchemaIssue[] = [];
  const decoded = decodeFields(schema, json, references, "", issues);
  return { value: asFieldValue<FieldsOf<S>>(decoded), issues };
}
