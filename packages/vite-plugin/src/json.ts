/**
 * The JSON value model this package works in, and the two narrowing predicates every other module
 * uses instead of `Array.isArray`.
 *
 * @remarks
 * The types are structurally identical to `@ignifx/core`'s: the same files travel between the two,
 * and `docs/architecture/00-overview.md` §2 gives this package no dependency it could import them
 * from. Keeping the model recursive rather than `unknown` is what stops a build-time value that JSON
 * cannot carry — a function, a `Date`, an `undefined` — from reaching a manifest or a `define`.
 */

/**
 * A JSON value.
 *
 * @public
 */
export type JsonValue = string | number | boolean | null | JsonArray | JsonObject;

/**
 * A JSON array.
 *
 * @public
 */
export type JsonArray = readonly JsonValue[];

/**
 * A JSON object.
 *
 * @public
 */
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Reports whether a JSON value is an object rather than an array, `null`, or a primitive.
 *
 * @remarks
 * `Array.isArray` alone does not narrow a `JsonValue`: `JsonArray` is a *readonly* array, which the
 * compiler cannot subtract in the false branch, and its true branch widens to `any[]`. This
 * predicate and {@link isJsonArray} are the one place that gap is papered over, so every other
 * module narrows in a single call and keeps its element types.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a JSON object.
 *
 * @example
 * ```ts
 * isJsonObject({ a: 1 }); // true
 * isJsonObject([1, 2]); // false
 * ```
 *
 * @public
 */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reports whether a JSON value is an array.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a JSON array, narrowed with its element type intact.
 *
 * @public
 */
export function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value);
}

/**
 * Reads a property of a JSON object without tripping `noPropertyAccessFromIndexSignature`, and
 * without ever reaching the prototype chain.
 *
 * @param object - The object to read.
 * @param key - The property name.
 * @returns The value, or `undefined` when the object has no such own property.
 *
 * @public
 */
export function jsonProperty(object: JsonObject, key: string): JsonValue | undefined {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/**
 * Parses JSON text into the JSON value model.
 *
 * @remarks
 * This is the one place in the package where `JSON.parse`'s `any` is narrowed. Every caller works
 * in {@link JsonValue} from here on, which is what lets the rest of the code check shapes instead of
 * asserting them (coding standards §5.2).
 *
 * @param text - The JSON text.
 * @returns The parsed value.
 * @throws A `SyntaxError` when the text is not JSON; callers turn that into a diagnostic.
 *
 * @public
 */
export function parseJsonValue(text: string): JsonValue {
  // The documented boundary assertion: `JSON.parse` is typed `any`, and every value it can produce
  // is a `JsonValue` by construction.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
  return JSON.parse(text) as JsonValue;
}
