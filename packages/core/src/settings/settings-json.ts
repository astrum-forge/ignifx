/**
 * The JSON form of project settings. Settings are read as written: `createApp` hands the project's
 * values to `validateProps` unencoded, so a `vec3` is `{ x, y, z }` and a `color` is
 * `{ r, g, b, a }`, not the scene file's arrays. Everything here describes that runtime form.
 */

import { assertNever } from "../errors/ignifx-error.js";
import { COLOR_CHANNELS, VECTOR_COMPONENTS } from "../schema/internal.js";
import { setOwnJsonProperty } from "../schema/json.js";
import type { JsonSchemaObject } from "../schema/describe.js";
import type { JsonObject, JsonValue } from "../schema/json.js";
import type { FieldDefinition } from "../schema/types.js";

/**
 * Reports whether a value is a plain bag of named values.
 *
 * @param value - The candidate.
 * @returns `true` for a non-null, non-array object.
 */
function isBag(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copies a value made of JSON data, dropping what JSON cannot carry.
 *
 * @param value - The value.
 * @returns The JSON copy, or `undefined` for a function, `undefined`, or a non-finite number.
 */
function plainJson(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => plainJson(item) ?? null);
  }
  if (isBag(value)) {
    return entriesToJson(Object.entries(value), plainJson);
  }
  return undefined;
}

/**
 * Builds a JSON object from entries, leaving out the ones that convert to nothing.
 *
 * @param entries - The name and value pairs.
 * @param convert - How one value converts.
 * @returns The object.
 */
function entriesToJson(
  entries: readonly (readonly [string, unknown])[],
  convert: (value: unknown, name: string) => JsonValue | undefined,
): JsonObject {
  const object: Record<string, JsonValue> = {};
  for (const [name, value] of entries) {
    const converted = convert(value, name);
    if (converted !== undefined) {
      // Defined, not assigned: a `__proto__` key stays an entry instead of changing the prototype.
      setOwnJsonProperty(object, name, converted);
    }
  }
  return object;
}

/**
 * Converts a runtime settings value into the JSON a settings file holds for it.
 *
 * @param field - The field the value belongs to.
 * @param value - The runtime value, such as a registered default.
 * @returns The JSON form, or `undefined` when the value does not fit the field.
 *
 * @internal
 */
export function settingsValueToJson(field: FieldDefinition<unknown>, value: unknown): JsonValue | undefined {
  const { spec } = field;
  switch (spec.kind) {
    case "vec2":
    case "vec3":
    case "vec4":
    case "quat": {
      return isBag(value)
        ? entriesToJson(channelEntries(VECTOR_COMPONENTS.slice(0, spec.components), value), plainJson)
        : undefined;
    }
    case "color": {
      return isBag(value) ? entriesToJson(channelEntries(COLOR_CHANNELS, value), plainJson) : undefined;
    }
    case "array": {
      return Array.isArray(value)
        ? value.map((item: unknown) => settingsValueToJson(spec.item, item) ?? null)
        : undefined;
    }
    case "record": {
      if (!isBag(value)) {
        return undefined;
      }
      const object: Record<string, JsonValue> = {};
      for (const [name, sub] of Object.entries(spec.fields)) {
        const converted = settingsValueToJson(sub, value[name]);
        if (converted !== undefined) {
          // Assigned: `record()` refuses `__proto__` and every other inherited name.
          object[name] = converted;
        }
      }
      return object;
    }
    case "map": {
      return isBag(value)
        ? entriesToJson(Object.entries(value), (entry) => settingsValueToJson(spec.value, entry))
        : undefined;
    }
    case "optional": {
      return value === null ? null : settingsValueToJson(spec.inner, value);
    }
    case "entityRef":
    case "componentRef": {
      // A reference names a live object; a settings file can only hold its absence.
      return value === null ? null : undefined;
    }
    case "asset": {
      if (isBag(value) && typeof value["address"] === "string") {
        return typeof value["type"] === "string"
          ? { address: value["address"], type: value["type"] }
          : { address: value["address"] };
      }
      return value === null ? null : undefined;
    }
    case "f32":
    case "f64":
    case "i32":
    case "u32":
    case "bool":
    case "str":
    case "enum":
    case "layerMask":
    case "curve":
    case "custom": {
      return plainJson(value);
    }
    default: {
      return assertNever(spec, "schema field kind");
    }
  }
}

/**
 * Pairs each channel name with the value's channel.
 *
 * @param names - The channel names.
 * @param value - The vector or colour.
 * @returns The pairs, in channel order.
 */
function channelEntries(
  names: readonly string[],
  value: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] {
  return names.map((name) => [name, value[name]] as const);
}

/**
 * The object schema of channel values, every channel required.
 *
 * @param names - The channel names.
 * @param channel - The schema of one channel.
 * @returns The fragment.
 */
function channelsSchema(names: readonly string[], channel: JsonSchemaObject): JsonSchemaObject {
  return {
    type: "object",
    properties: Object.fromEntries(names.map((name) => [name, channel])),
    required: [...names],
  };
}

/**
 * Builds the JSON Schema of one settings field in the form `createApp` reads, with its default, its
 * tooltip, its bounds and the `x-ignifx-*` inspector keywords.
 *
 * @param field - The field.
 * @param defaultValue - The runtime default to annotate it with, or `undefined` for none.
 * @returns The fragment.
 *
 * @internal
 */
export function settingsFieldJsonSchema(field: FieldDefinition<unknown>, defaultValue: unknown): JsonSchemaObject {
  const fragment: Record<string, JsonValue> = { ...settingsKindJsonSchema(field) };
  const { tooltip, min, max, step, hidden, readonly, group } = field.options;
  const annotations: Record<string, JsonValue | undefined> = {
    description: tooltip,
    minimum: min,
    maximum: max,
    "x-ignifx-step": step,
    "x-ignifx-hidden": hidden,
    "x-ignifx-readonly": readonly,
    "x-ignifx-group": group,
    default: defaultValue === undefined ? undefined : settingsValueToJson(field, defaultValue),
  };
  for (const [keyword, value] of Object.entries(annotations)) {
    if (value !== undefined) {
      fragment[keyword] = value;
    }
  }
  return fragment;
}

/**
 * Builds the object schema of a group of settings fields: every field optional, no other key.
 *
 * @param fields - The fields.
 * @param defaults - The runtime defaults by field name; a field without one carries no `default`.
 * @returns The fragment.
 *
 * @internal
 */
export function settingsObjectJsonSchema(
  fields: Readonly<Record<string, FieldDefinition<unknown>>>,
  defaults: Readonly<Record<string, unknown>>,
): JsonSchemaObject {
  const properties: Record<string, JsonValue> = {};
  for (const [name, field] of Object.entries(fields)) {
    properties[name] = settingsFieldJsonSchema(field, defaults[name]);
  }
  return { type: "object", properties, additionalProperties: false };
}

/**
 * Builds the fragment that constrains a field's runtime form, mirroring `validateProps`.
 *
 * @param field - The field.
 * @returns The fragment, without annotations.
 */
function settingsKindJsonSchema(field: FieldDefinition<unknown>): JsonSchemaObject {
  const { spec } = field;
  switch (spec.kind) {
    case "f32":
    case "f64": {
      return { type: "number" };
    }
    case "i32": {
      return { type: "integer", minimum: -2147483648, maximum: 2147483647 };
    }
    case "u32": {
      return { type: "integer", minimum: 0, maximum: 4294967295 };
    }
    case "bool": {
      return { type: "boolean" };
    }
    case "str": {
      return { type: "string" };
    }
    case "enum": {
      return { type: "string", enum: [...spec.values] };
    }
    case "vec2":
    case "vec3":
    case "vec4":
    case "quat": {
      return channelsSchema(VECTOR_COMPONENTS.slice(0, spec.components), { type: "number" });
    }
    case "color": {
      return channelsSchema(COLOR_CHANNELS, { type: "number", minimum: 0, maximum: 1 });
    }
    case "entityRef":
    case "componentRef": {
      return { oneOf: [{ type: "object" }, { type: "null" }] };
    }
    case "asset": {
      return {
        oneOf: [
          { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
          { type: "null" },
        ],
      };
    }
    case "array": {
      return { type: "array", items: settingsFieldJsonSchema(spec.item, undefined) };
    }
    case "record": {
      return settingsObjectJsonSchema(spec.fields, {});
    }
    case "map": {
      return { type: "object", additionalProperties: settingsFieldJsonSchema(spec.value, undefined) };
    }
    case "optional": {
      // `anyOf`, because an inner kind that itself accepts `null` would match both branches.
      return { anyOf: [settingsFieldJsonSchema(spec.inner, undefined), { type: "null" }] };
    }
    case "layerMask": {
      return { type: "array", items: { type: "string" } };
    }
    case "curve": {
      return {
        type: "object",
        properties: {
          keys: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 } },
        },
        required: ["keys"],
      };
    }
    case "custom": {
      // A custom field's runtime shape is its codec's business, as in `validateProps`.
      return {};
    }
    default: {
      return assertNever(spec, "schema field kind");
    }
  }
}
