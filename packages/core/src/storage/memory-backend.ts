import type { StorageBackend, StoredValue } from "./backend.js";

/**
 * The in-memory storage backend: the default for a headless app, and the one every unit test in the
 * engine runs against (`docs/architecture/14-platform-electron.md` §2, §5).
 *
 * It is the reference implementation of `./backend.ts`: nothing here is a shortcut for being
 * in-process. Values are copied in and out, so a caller that mutates the `Uint8Array` it wrote
 * cannot reach the store; namespaces are separate maps rather than prefixed keys; and every method
 * is asynchronous even though none of them needs to be, because game code written against this
 * backend has to keep working on IndexedDB.
 */

/**
 * A store that lives as long as the app does.
 *
 * @example
 * ```ts
 * const app = await createApp({ storage: new MemoryStorageBackend() });
 * ```
 *
 * @public
 */
export class MemoryStorageBackend implements StorageBackend {
  /** The identifier that appears in error context. */
  readonly name = "memory";

  /** Namespace path to that namespace's values. */
  readonly #namespaces = new Map<string, Map<string, StoredValue>>();

  /**
   * Reads one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key.
   * @returns A copy of the stored value, or `null`.
   */
  async get(namespace: string, key: string): Promise<StoredValue | null> {
    const found = this.#namespaces.get(namespace)?.get(key);
    return found === undefined ? null : copyValue(found);
  }

  /**
   * Writes one value.
   *
   * @param namespace - The namespace path, created on demand.
   * @param key - The key.
   * @param value - The value to copy in.
   * @returns A promise that settles once the value is stored.
   */
  async set(namespace: string, key: string, value: StoredValue): Promise<void> {
    let values = this.#namespaces.get(namespace);
    if (values === undefined) {
      values = new Map<string, StoredValue>();
      this.#namespaces.set(namespace, values);
    }
    values.set(key, copyValue(value));
  }

  /**
   * Removes one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key.
   * @returns A promise that settles once the value is gone.
   */
  async delete(namespace: string, key: string): Promise<void> {
    this.#namespaces.get(namespace)?.delete(key);
  }

  /**
   * Lists one namespace's keys.
   *
   * @param namespace - The namespace path.
   * @param prefix - An optional key prefix.
   * @returns The matching keys, sorted ascending.
   */
  async keys(namespace: string, prefix?: string): Promise<readonly string[]> {
    const values = this.#namespaces.get(namespace);
    if (values === undefined) {
      return [];
    }
    const found: string[] = [];
    for (const key of values.keys()) {
      if (prefix === undefined || key.startsWith(prefix)) {
        found.push(key);
      }
    }
    return found.toSorted();
  }

  /**
   * Empties one namespace.
   *
   * @param namespace - The namespace path.
   * @returns A promise that settles once the namespace is empty.
   */
  async clear(namespace: string): Promise<void> {
    this.#namespaces.delete(namespace);
  }

  /** Drops every namespace. */
  dispose(): void {
    this.#namespaces.clear();
  }
}

/**
 * Copies a stored value so that neither side can mutate the other's octets.
 *
 * @param value - The value to copy.
 * @returns A value with its own buffer; JSON values are already immutable strings.
 */
function copyValue(value: StoredValue): StoredValue {
  return value.kind === "json" ? value : { kind: "bytes", bytes: value.bytes.slice() };
}
