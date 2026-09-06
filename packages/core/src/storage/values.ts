import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { canonicalizeNumber } from "../schema/encode.js";
import type { StoredValue } from "./backend.js";

/**
 * The value codec that sits between game code and a {@link StoredValue}
 * (`docs/architecture/14-platform-electron.md` §2). It is the *only* place a user object is turned
 * into something a backend can persist, which is what keeps the three backends interchangeable.
 *
 * Two representations, chosen by the value's own type:
 *
 * - `Blob`, `ArrayBuffer` and any `ArrayBufferView` become **bytes**, copied out of the caller's
 *   buffer so a later mutation cannot reach the store.
 * - Everything else becomes **canonical JSON text**: `JSON.stringify` with a replacer that rounds
 *   every number through {@link canonicalizeNumber}, the same six-decimal rounding
 *   `docs/architecture/06-serialization-and-scene-format.md` §2 applies to scene files. A save game
 *   written twice from the same state is therefore byte-identical, which is what makes the
 *   round-trip assertion in the save/load tests meaningful. Object key order is *not* sorted: it is
 *   the insertion order of the value, exactly as `stringifySceneFile` leaves it.
 */

/**
 * Reports whether a value is stored as bytes rather than as JSON.
 *
 * @param value - The candidate value.
 * @returns `true` for `Blob`, `ArrayBuffer`, and any typed array or `DataView`; the signature is a
 * type predicate, so the caller reaches {@link toBytes} without an assertion.
 *
 * @internal
 */
export function isBinaryValue(value: unknown): value is Blob | ArrayBuffer | ArrayBufferView {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob;
}

/**
 * Copies the octets out of a binary value, into a buffer the store owns.
 *
 * @param value - A `Blob`, an `ArrayBuffer`, or a view over one.
 * @returns The octets. A view contributes only the window it describes, not its whole buffer.
 */
async function toBytes(value: Blob | ArrayBuffer | ArrayBufferView): Promise<Uint8Array> {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  return new Uint8Array(await value.arrayBuffer());
}

/**
 * Rounds every number a value carries, so two saves of the same state produce the same text.
 *
 * @param _key - The property name `JSON.stringify` is visiting; unused.
 * @param value - The property value.
 * @returns The value, with numbers canonicalized.
 */
function canonicalReplacer(_key: string, value: unknown): unknown {
  return typeof value === "number" ? canonicalizeNumber(value) : value;
}

/**
 * Turns a value handed to `Storage.set` into something a backend can persist.
 *
 * @param key - The key being written; it appears in the error context.
 * @param value - The value.
 * @returns The stored form: canonical JSON text, or copied octets.
 * @throws IgnifxError with code `IGX-1423` when the value cannot become JSON — a cycle, a
 * `BigInt`, or a value such as `undefined` or a function that `JSON.stringify` erases entirely.
 *
 * @example
 * ```ts
 * await toStoredValue("audio", { volume: 0.1 + 0.2 }); // { kind: "json", json: '{"volume":0.3}' }
 * ```
 *
 * @internal
 */
export async function toStoredValue(key: string, value: unknown): Promise<StoredValue> {
  if (isBinaryValue(value)) {
    return { kind: "bytes", bytes: await toBytes(value) };
  }
  // `unknown`, not `string`: the DOM library types `JSON.stringify` as total, but it really does
  // return `undefined` for `undefined`, a function, or a symbol.
  let json: unknown;
  try {
    json = JSON.stringify(value, canonicalReplacer);
  } catch (cause: unknown) {
    throw new IgnifxError(CoreErrorCode.storageValueNotSerializable, `The value stored at ${key} is not JSON.`, {
      cause,
      context: { key },
      hint: "Storage holds JSON values, Blobs, ArrayBuffers, and typed arrays; convert anything else first.",
    });
  }
  if (typeof json !== "string") {
    throw new IgnifxError(CoreErrorCode.storageValueNotSerializable, `The value stored at ${key} is not JSON.`, {
      context: { key },
      hint: "undefined, functions, and symbols have no JSON form; store null instead.",
    });
  }
  return { kind: "json", json };
}

/**
 * Turns what a backend returned back into a value.
 *
 * @typeParam T - What the caller declares the key holds.
 * @param key - The key being read; it appears in the error context.
 * @param stored - What the backend returned.
 * @returns The value. A `"bytes"` value always comes back as a `Uint8Array`, whatever binary type
 * was written: the octets round-trip, the wrapper does not.
 * @throws IgnifxError with code `IGX-1426` when a `"json"` value is not parseable, which means the
 * store was damaged or written by something other than ignifx.
 *
 * @internal
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see `Storage.get`.
export function fromStoredValue<T>(key: string, stored: StoredValue): T {
  if (stored.kind === "bytes") {
    // Boundary assertion (coding standards §5.2): `T` is the caller's declaration of what this key
    // holds, exactly as it is for `JSON.parse`. A caller that wrote a Blob reads back a Uint8Array.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return stored.bytes as T;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.json);
  } catch (cause: unknown) {
    throw new IgnifxError(CoreErrorCode.storageValueCorrupt, `The value stored at ${key} is not readable.`, {
      cause,
      context: { key },
      hint: "Delete the key, or restore the store from a backup.",
    });
  }
  // Boundary assertion (coding standards §5.2): see above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parsed as T;
}
