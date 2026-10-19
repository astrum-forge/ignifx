/**
 * `describeSettings`: the project's settings sections, as the editor's settings panel reads them,
 * and the values the app resolved for them.
 */

import { describeSettings, settingsJsonSchema } from "@ignifx/core";
import type { JsonObject, JsonValue, SchemaDescription, SettingsSet } from "../protocol/index.js";
import type { App } from "@ignifx/core";

/**
 * Copies a value made of JSON data, leaving out what JSON cannot carry.
 *
 * @param value - The value.
 * @returns The copy, or `undefined` for a function, `undefined`, a symbol, a bigint or a
 * non-finite number.
 */
function jsonCopy(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => jsonCopy(item) ?? null);
  }
  if (typeof value === "object") {
    return jsonObjectCopy(value);
  }
  return undefined;
}

/**
 * Copies an object's own enumerable members with {@link jsonCopy}.
 *
 * @param value - The object.
 * @returns The copy.
 */
function jsonObjectCopy(value: object): JsonObject {
  const copy: Record<string, JsonValue> = {};
  for (const [key, member] of Object.entries(value)) {
    const converted = jsonCopy(member);
    if (converted !== undefined) {
      copy[key] = converted;
    }
  }
  return copy;
}

/**
 * Tells whether a JSON value is an object.
 *
 * @param value - The value.
 * @returns True for an object that is not an array.
 */
function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Describes every settings section the app registered with core's `describeSettings`, each with
 * its JSON Schema from `settingsJsonSchema` as `propsSchema`, and copies the value the app resolved
 * for each section.
 *
 * @remarks
 * Settings are held in the settings form (`{ x, y, z }` for a vector), which is plain data, so a
 * section's value is copied member by member; a member JSON cannot carry is left out. The answer is
 * read from the app each time and sent only on request.
 *
 * @param app - The scene view's app.
 * @returns The sections and their values, keyed by section name in registration order.
 */
export function settingsSet(app: App): SettingsSet {
  const described = describeSettings(app);
  const properties = settingsJsonSchema(app)["properties"];
  const sections: Record<string, SchemaDescription> = {};
  const values: Record<string, JsonObject> = {};
  for (const [name, description] of Object.entries(described)) {
    const propsSchema = isObject(properties) ? properties[name] : undefined;
    sections[name] = isObject(propsSchema) ? { ...description, propsSchema } : description;
    const value: unknown = app.settings.section(name);
    values[name] = typeof value === "object" && value !== null ? jsonObjectCopy(value) : {};
  }
  return { sections, values };
}
