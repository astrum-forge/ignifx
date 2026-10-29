/**
 * The JSON value model the serializer works in. Scene and prefab files are UTF-8 JSON
 * (`docs/architecture/06-serialization-and-scene-format.md` §1), so every encoded schema value is
 * one of these shapes. The type is recursive rather than `unknown` so that encoders cannot smuggle
 * a `Date`, a `Map`, or an `undefined` into a file (coding standards §5.2 bans `any`).
 *
 * @public
 */
export type JsonValue = string | number | boolean | null | JsonArray | JsonObject;

/**
 * A JSON array. Read-only because encoded values are snapshots: callers copy before mutating.
 *
 * @public
 */
export type JsonArray = readonly JsonValue[];

/**
 * A JSON object. Keys are emitted in the canonical order defined by
 * `docs/architecture/06-serialization-and-scene-format.md` §1, so two saves of the same state
 * produce byte-identical files.
 *
 * @public
 */
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Sets a key on an object being built from JSON as an own, enumerable data property — what
 * `JSON.parse` does. A plain `target[key] = value` treats the key `__proto__` as the prototype
 * setter, so a file carrying that key would change the copy's prototype instead of holding data.
 *
 * @param target - The object under construction.
 * @param key - The key, taken from parsed JSON.
 * @param value - The value.
 *
 * @internal
 */
export function setOwnJsonProperty<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
