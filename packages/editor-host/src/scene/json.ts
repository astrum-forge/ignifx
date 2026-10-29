/**
 * JSON helpers the scene ops and the walk for held references share: narrowing JSON, and telling
 * which entities and components a value names.
 */

import type { JsonObject, JsonValue } from "@ignifx/core";

/**
 * The uid of a referenced entity or component.
 *
 * @param target - The field's value.
 * @returns Its uid, or `null` for anything without one.
 */
export function uidOf(target: unknown): string | null {
  const uid: unknown = typeof target === "object" && target !== null ? Reflect.get(target, "uid") : null;
  return typeof uid === "string" ? uid : null;
}

/**
 * Narrows JSON to an object. `Array.isArray` does not remove a readonly array from the union, so the
 * discrimination lives here once.
 *
 * @param value - The JSON.
 * @returns The object, or `null` for anything else.
 */
export function asJsonObject(value: JsonValue | undefined): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // The guard above leaves exactly `JsonObject` of the `JsonValue` union.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as JsonObject;
}

/**
 * Narrows JSON to an array.
 *
 * @param value - The JSON.
 * @returns The array, or `null`.
 */
export function asJsonArray(value: JsonValue | undefined): readonly JsonValue[] | null {
  return Array.isArray(value) ? value : null;
}

/**
 * Tells whether JSON references an entity or component of a set.
 *
 * @param value - The JSON.
 * @param entities - The entity uids.
 * @param components - The component uids.
 * @returns True when a `$entity` or `$component` names one of them.
 */
export function pointsInto(
  value: JsonValue | undefined,
  entities: ReadonlySet<string>,
  components: ReadonlySet<string>,
): boolean {
  const array = asJsonArray(value);
  if (array !== null) {
    return array.some((item) => pointsInto(item, entities, components));
  }
  const object = asJsonObject(value);
  if (object === null) {
    return false;
  }
  const entity = object["$entity"];
  const component = object["$component"];
  return (
    (typeof entity === "string" && entities.has(entity)) ||
    (typeof component === "string" && components.has(component)) ||
    Object.values(object).some((item) => pointsInto(item, entities, components))
  );
}
