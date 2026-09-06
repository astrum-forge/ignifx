import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { DEFAULT_STORAGE_NAMESPACE, assertStorageKey, joinNamespace } from "./names.js";
import { fromStoredValue, toStoredValue } from "./values.js";
import type { StorageBackend } from "./backend.js";

/**
 * `app.storage`: the small, asynchronous key-value store a game keeps its settings, its save slots,
 * and its input rebindings in (`docs/architecture/14-platform-electron.md` §2).
 *
 * The facade owns policy and the backend owns persistence (`./backend.ts`). Everything a game sees
 * — namespaces, JSON canonicalization, `Blob` support, the error codes — lives here, once, so that
 * a save written under Node's memory backend in a unit test reads back identically from IndexedDB
 * in a browser and from the Electron bridge on a desktop build.
 *
 * ## Decisions the documents left open
 *
 * - **A namespace is a backend scope, not a key prefix.** §2 offers `namespace(name)` without
 *   saying which. A scope is the stronger contract: `keys()` on `"saves"` cannot leak a key from
 *   `"saves-old"`, a directory backend gets one directory per namespace for free, and clearing a
 *   namespace is one operation rather than a scan. Nested namespaces join with `/`, so
 *   `storage.namespace("saves").namespace("coop")` is the scope `"saves/coop"` — a *different*
 *   scope from `"saves"`, whose keys it does not list.
 * - **`app.storage` itself is the namespace `"default"`.** Every backend call carries a namespace,
 *   so the root needs a name rather than an empty string each backend would special-case.
 * - **`namespace(name)` is memoized.** Two calls with the same name return the same object, which
 *   makes `app.storage.namespace("saves") === app.storage.namespace("saves")` true and keeps a
 *   per-frame call from allocating.
 */

/**
 * The store reached as `app.storage`, and as `app.storage.namespace(name)`.
 *
 * @remarks
 * Values are JSON, or binary: a `Blob`, an `ArrayBuffer`, or any typed array is stored as octets
 * and read back as a `Uint8Array`. Numbers inside JSON values are canonicalized the way scene files
 * canonicalize them (`docs/architecture/06-serialization-and-scene-format.md` §2), so writing the
 * same state twice produces the same bytes.
 *
 * Reads and writes are asynchronous on every backend, including the in-memory one, so that game
 * code written against a test app keeps working on IndexedDB.
 *
 * @example
 * ```ts
 * const settings = app.storage.namespace("settings");
 * await settings.set("audio", { master: 0.8, music: 0.5 });
 * const audio = await settings.get<{ master: number; music: number }>("audio");
 * ```
 *
 * @public
 */
export interface Storage {
  /**
   * Reads one value.
   *
   * @typeParam T - What the caller declares the key holds; unchecked, as for `JSON.parse`.
   * @param key - The key, 1–512 characters with no control characters.
   * @returns The value, or `null` when the key was never written.
   * @throws IgnifxError with code `IGX-1422` when the key is invalid, `IGX-1426` when the stored
   * value cannot be read back, or `IGX-1425` when the backend fails.
   */
  // `T` is the caller's declaration of what the key holds — the `JSON.parse` escape hatch.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see above.
  get<T>(key: string): Promise<T | null>;

  /**
   * Writes one value, replacing whatever was there.
   *
   * @typeParam T - The value's type.
   * @param key - The key, 1–512 characters with no control characters.
   * @param value - A JSON value, a `Blob`, an `ArrayBuffer`, or a typed array.
   * @returns A promise that settles once the value is durable.
   * @throws IgnifxError with code `IGX-1422` when the key is invalid, `IGX-1423` when the value has
   * no JSON form, `IGX-1424` when the host is out of quota, or `IGX-1425` when the backend fails.
   */
  // The parameter names the written type so `set<Settings>(…)` reads next to its `get<Settings>`.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see above.
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Removes one value.
   *
   * @param key - The key.
   * @returns A promise that settles once the value is gone. Deleting an absent key is a no-op.
   * @throws IgnifxError with code `IGX-1422` when the key is invalid, or `IGX-1425` when the
   * backend fails.
   */
  delete(key: string): Promise<void>;

  /**
   * Lists this namespace's keys.
   *
   * @param prefix - When given, only keys that start with this string are returned.
   * @returns The keys, sorted ascending. Keys of nested namespaces are not included.
   * @throws IgnifxError with code `IGX-1425` when the backend fails.
   */
  keys(prefix?: string): Promise<readonly string[]>;

  /**
   * Narrows to a child namespace — `"saves"`, `"settings"`, `"input-overrides"`.
   *
   * @param name - 1–64 characters of `A`–`Z`, `a`–`z`, `0`–`9`, `.`, `_`, `-`; not `.` or `..`.
   * @returns The child store, which shares this store's backend and sees none of its keys.
   * @throws IgnifxError with code `IGX-1421` when the name is not a legal namespace segment.
   */
  namespace(name: string): Storage;
}

/**
 * The `Storage` implementation: one object per namespace, all of them sharing one backend.
 *
 * @internal
 */
export class StorageImpl implements Storage {
  /** The backend every call is forwarded to. Replaced in place by `setBackend`. */
  #backend: StorageBackend;

  /** This store's namespace path, `"default"` at the root. */
  readonly #namespace: string;

  /** Memoized child namespaces, so repeated `namespace(name)` calls allocate once. */
  readonly #children = new Map<string, StorageImpl>();

  /**
   * Builds a store.
   *
   * @param backend - Where values are persisted.
   * @param namespace - This store's namespace path. Defaults to `"default"`.
   */
  constructor(backend: StorageBackend, namespace: string = DEFAULT_STORAGE_NAMESPACE) {
    this.#backend = backend;
    this.#namespace = namespace;
  }

  /**
   * This store's namespace path.
   *
   * @returns The path, `"default"` at the root and `"saves/coop"` two levels down.
   */
  get namespacePath(): string {
    return this.#namespace;
  }

  /**
   * The backend behind this store and every namespace derived from it.
   *
   * @returns The backend.
   */
  get backend(): StorageBackend {
    return this.#backend;
  }

  /**
   * Swaps the backend of this store and of every namespace already derived from it.
   *
   * @remarks
   * This is how `@ignifx/electron`'s renderer extension installs the file-system backend after
   * `createApp` has already built the default one: the `app.storage` object a script may already
   * hold keeps working and starts writing through the bridge.
   *
   * @param backend - The replacement backend.
   */
  setBackend(backend: StorageBackend): void {
    this.#backend = backend;
    for (const child of this.#children.values()) {
      child.setBackend(backend);
    }
  }

  /**
   * Reads one value.
   *
   * @typeParam T - What the caller declares the key holds.
   * @param key - The key.
   * @returns The value, or `null`.
   */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see `Storage.get`.
  async get<T>(key: string): Promise<T | null> {
    assertStorageKey(key);
    const stored = await this.#backend.get(this.#namespace, key);
    return stored === null ? null : fromStoredValue<T>(key, stored);
  }

  /**
   * Writes one value.
   *
   * @typeParam T - The value's type.
   * @param key - The key.
   * @param value - The value.
   * @returns A promise that settles once the value is durable.
   */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see `Storage.set`.
  async set<T>(key: string, value: T): Promise<void> {
    assertStorageKey(key);
    await this.#backend.set(this.#namespace, key, await toStoredValue(key, value));
  }

  /**
   * Removes one value.
   *
   * @param key - The key.
   * @returns A promise that settles once the value is gone.
   */
  async delete(key: string): Promise<void> {
    assertStorageKey(key);
    await this.#backend.delete(this.#namespace, key);
  }

  /**
   * Lists this namespace's keys.
   *
   * @param prefix - An optional key prefix.
   * @returns The keys, sorted ascending.
   */
  async keys(prefix?: string): Promise<readonly string[]> {
    return prefix === undefined ? this.#backend.keys(this.#namespace) : this.#backend.keys(this.#namespace, prefix);
  }

  /**
   * Narrows to a child namespace.
   *
   * @param name - The child segment.
   * @returns The child store.
   */
  namespace(name: string): Storage {
    const found = this.#children.get(name);
    if (found !== undefined) {
      return found;
    }
    const child = new StorageImpl(this.#backend, joinNamespace(this.#namespace, name));
    this.#children.set(name, child);
    return child;
  }
}

/**
 * Reaches the engine-owned half of a `Storage`, the way `rendererInternals` does for the
 * renderer. `@ignifx/electron` uses it to install its bridge backend after `createApp`.
 *
 * @param storage - The store, normally `app.storage`.
 * @returns The implementation.
 * @throws IgnifxError with code `IGX-0702` when the object was not created by this copy of
 * `@ignifx/core`.
 *
 * @example
 * ```ts
 * storageInternals(app.storage).setBackend(new ElectronFileStorageBackend(host));
 * ```
 *
 * @internal
 */
export function storageInternals(storage: Storage): StorageImpl {
  if (storage instanceof StorageImpl) {
    return storage;
  }
  throw new IgnifxError(CoreErrorCode.invalidRuntime, "app.storage was not created by this copy of @ignifx/core.", {
    context: { member: "app.storage" },
    hint: "Reach the service through the app that created it.",
  });
}
