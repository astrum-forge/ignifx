/**
 * The contract every storage backend implements, and the value shape backends persist
 * (`docs/architecture/14-platform-electron.md` §2). This module declares types only — no behaviour,
 * no imports — so that `@ignifx/electron` can implement the contract without depending on anything
 * else in the kernel, and so that {@link StorageBackend} can be quoted in full in a design review.
 *
 * The split of responsibilities is the whole point of the contract:
 *
 * - The `Storage` facade (`./storage.ts`) owns **policy**: it validates namespace and key syntax,
 *   turns a JavaScript value into a {@link StoredValue} (canonical JSON text, or bytes), and turns a
 *   {@link StoredValue} back into a value. A backend never sees a user object.
 * - A backend owns **persistence**: it stores opaque JSON text or opaque bytes under a
 *   `(namespace, key)` pair, and reports failures as `IgnifxError`s from the storage code block.
 *
 * A backend that keeps those two rules is interchangeable with every other one, which is what makes
 * the same save file readable from the memory backend in a unit test, the IndexedDB backend in a
 * browser, and the Electron file-system backend on a desktop build.
 */

/**
 * Which of the two representations a stored value uses.
 *
 * @remarks
 * `"json"` carries text produced by the facade's canonical `JSON.stringify`; `"bytes"` carries the
 * raw octets of a `Blob`, `ArrayBuffer`, or `Uint8Array` the caller handed to `set`. The kind is
 * stored alongside the payload — a backend that loses it cannot round-trip, because JSON text and
 * a UTF-8 byte array are indistinguishable once written.
 *
 * @public
 */
export type StoredValueKind = "json" | "bytes";

/**
 * A value as a backend sees it: opaque JSON text, or opaque octets.
 *
 * @remarks
 * The two members are a discriminated union on their `kind`, so a backend switches once
 * and the compiler proves both arms are handled. Backends must round-trip both members exactly: the
 * `json` string that comes back from {@link StorageBackend.get} has to be the same string that went
 * into {@link StorageBackend.set}, and the `bytes` have to be byte-identical and the same length. A
 * backend may copy the bytes (IndexedDB's structured clone does) but must never alias the caller's
 * buffer after `set` resolves.
 *
 * @example
 * ```ts
 * const value: StoredValue = { kind: "json", json: '{"volume":0.8}' };
 * await backend.set("settings", "audio", value);
 * ```
 *
 * @public
 */
export type StoredValue =
  | {
      /** Discriminant: this value is JSON text. */
      readonly kind: "json";
      /** The canonical JSON text of the value. Never `undefined`, never empty. */
      readonly json: string;
    }
  | {
      /** Discriminant: this value is a byte array. */
      readonly kind: "bytes";
      /** The octets. May be empty. */
      readonly bytes: Uint8Array;
    };

/**
 * Where `app.storage` actually puts things (`docs/architecture/14-platform-electron.md` §2).
 *
 * @remarks
 * **The contract.** Implementations may assume all of the following, because the `Storage` facade
 * guarantees them before every call:
 *
 * 1. `namespace` is a non-empty `/`-joined path of segments; each segment is 1–64 characters of
 *    `A`–`Z`, `a`–`z`, `0`–`9`, `.`, `_`, or `-`, and no segment is `.` or `..`. A backend that maps
 *    namespaces onto a hierarchy (directories, object stores) must encode each segment so that two
 *    namespaces differing only in case cannot collide on a case-insensitive file system.
 * 2. `key` is 1–512 characters, contains no C0 or C1 control character, and is otherwise arbitrary
 *    Unicode — including `/`, `..`, `:`, and characters Windows forbids in file names. Keys are
 *    opaque: a backend never interprets a key's structure, and `keys(namespace, prefix)` is a plain
 *    string-prefix filter, not a path walk.
 * 3. Namespaces are **scopes, not prefixes**: `get("saves", "a")` and `get("saves/coop", "a")` name
 *    two different values, and neither appears in the other's `keys()` listing.
 *
 * Implementations must guarantee all of the following:
 *
 * 4. `get` resolves `null` for an absent key — absence is not an error.
 * 5. `set` replaces any existing value under the same `(namespace, key)`, whatever its kind, and
 *    is atomic against a crash: a reader either sees the whole previous value or the whole new one,
 *    never a partial write. `delete` on an absent key resolves without error.
 * 6. `keys` resolves the keys of one namespace, filtered by `prefix` when it is given, sorted
 *    ascending with the default `Array.prototype.sort` comparison (UTF-16 code unit order). An
 *    unknown namespace lists as `[]` rather than throwing.
 * 7. `clear` removes every key of one namespace and leaves other namespaces untouched. Clearing an
 *    unknown namespace resolves without error.
 * 8. Every rejection is an `IgnifxError` carrying a code from the storage block: `IGX-1424` when the
 *    host is out of quota, `IGX-1426` when a stored value cannot be read back, and `IGX-1425` for
 *    every other backend failure, with the underlying failure as `cause`. Backends never reject with
 *    a raw `DOMException` or a Node `SystemError`.
 * 9. Every method is safe to call concurrently. Two `set` calls on the same key may land in either
 *    order, but neither may leave the store damaged.
 *
 * @example
 * ```ts
 * const backend: StorageBackend = new MemoryStorageBackend();
 * await backend.set("saves", "slot1", { kind: "json", json: '{"level":3}' });
 * await backend.keys("saves"); // ["slot1"]
 * ```
 *
 * @public
 */
export interface StorageBackend {
  /**
   * A short, stable identifier for this backend — `"memory"`, `"file"`, `"indexeddb"`,
   * `"electron-file"`. It appears in error context so a failure names the store it came from.
   */
  readonly name: string;

  /**
   * Reads one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside that namespace.
   * @returns The stored value, or `null` when the namespace has no such key.
   */
  get(namespace: string, key: string): Promise<StoredValue | null>;

  /**
   * Writes one value, replacing whatever was there.
   *
   * @param namespace - The namespace path, created on demand.
   * @param key - The key inside that namespace.
   * @param value - The JSON text or the octets to persist.
   * @returns A promise that settles once the value is durable.
   */
  set(namespace: string, key: string, value: StoredValue): Promise<void>;

  /**
   * Removes one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside that namespace.
   * @returns A promise that settles once the value is gone; removing an absent key is a no-op.
   */
  delete(namespace: string, key: string): Promise<void>;

  /**
   * Lists the keys of one namespace.
   *
   * @param namespace - The namespace path.
   * @param prefix - When given, only keys that start with this string are returned.
   * @returns The matching keys, sorted ascending; `[]` for an unknown namespace.
   */
  keys(namespace: string, prefix?: string): Promise<readonly string[]>;

  /**
   * Removes every value of one namespace.
   *
   * @param namespace - The namespace path.
   * @returns A promise that settles once the namespace is empty; an unknown namespace is a no-op.
   */
  clear(namespace: string): Promise<void>;

  /**
   * Releases whatever the backend holds open — an IndexedDB connection, a file handle, a bridge
   * subscription. Called from `app.dispose()`. Disposing twice is a no-op, and a backend that holds
   * nothing may omit the method entirely.
   */
  dispose?(): void;
}
