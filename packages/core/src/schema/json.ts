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
