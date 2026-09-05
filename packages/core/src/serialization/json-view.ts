import type { JsonArray, JsonObject, JsonValue } from "../schema/json.js";

/**
 * Narrows a JSON value to an object. `Array.isArray` alone does not remove `JsonArray` from the
 * `JsonValue` union in a way that lets the object half be indexed by an arbitrary string, so the
 * whole discrimination lives here rather than being repeated with an assertion at every call site.
 *
 * @param value - The JSON to narrow.
 * @returns The object, or `null` when the value is an array, `null`, or a primitive.
 *
 * @internal
 */
export function asJsonObject(value: JsonValue | undefined): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // Boundary assertion (coding standards §5.2): the guard above is exactly `JsonObject` — an
  // object that is neither `null` nor an array — which is what `JsonValue` leaves in the union.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as JsonObject;
}

/**
 * Narrows a JSON value to an array.
 *
 * @param value - The JSON to narrow.
 * @returns The array, or `null` when the value is not one.
 *
 * @internal
 */
export function asJsonArray(value: JsonValue | undefined): JsonArray | null {
  return Array.isArray(value) ? value : null;
}
