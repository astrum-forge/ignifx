import { CoreErrorCode } from "../../errors/error-codes.js";
import { IgnifxError } from "../../errors/ignifx-error.js";
import type { StorageBackend, StoredValue } from "../backend.js";

/**
 * The IndexedDB storage backend: the browser and Electron-renderer default
 * (`docs/architecture/14-platform-electron.md` §2). Every line of it needs a real `indexedDB`, so
 * the file lives under `src/storage/web/**` and is covered by the Vitest `browser` project, under
 * the same rule as `src/lite/gpu/**` and `src/lite/web/**`.
 *
 * ## Decisions the documents left open
 *
 * - **One object store, not one per namespace.** §2 does not say. A store per namespace would need
 *   an IndexedDB *version upgrade* the first time a game called `storage.namespace("new-thing")`,
 *   and a version upgrade is blocked while another tab holds the database open — so the first save
 *   in a second tab could hang forever. One store named `values`, with the out-of-line compound key
 *   `[namespace, key]`, needs no upgrade to add a namespace, and IndexedDB's own array-key ordering
 *   makes a namespace listing a single bounded cursor that already comes out sorted.
 * - **The database is opened without a version.** That takes whatever version exists, so a build
 *   that is older than the one that last wrote still opens the store instead of failing with a
 *   `VersionError`. If the `values` store is missing — a fresh profile, or an `ignifx` database
 *   created by something else — the backend reopens one version higher and creates it. That is the
 *   whole of the upgrade path while the format has one store.
 * - **The connection is opened lazily.** Constructing a backend must not touch the host
 *   (`CONSTITUTION.md` §3.5); the first `get`/`set`/`keys`/`clear` opens the database, and every
 *   later call awaits the same promise.
 */

/** The database every ignifx app in one origin shares. */
const DATABASE_NAME = "ignifx";

/** The single object store, keyed by `[namespace, key]`. */
const STORE_NAME = "values";

/** The `DOMException` names that mean the origin is out of storage quota. */
// oxlint-disable-next-line unicorn/prefer-set-has -- a module-scope Set is an import-time allocation (CONSTITUTION.md 3.5).
const QUOTA_ERROR_NAMES: readonly string[] = ["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"];

/**
 * Wraps a failure in the storage error the backend contract promises.
 *
 * @param error - The rejection value, normally a `DOMException`.
 * @param operation - What was being attempted, for the message.
 * @returns The error to throw.
 */
function toStorageError(error: unknown, operation: string): IgnifxError {
  const name = error instanceof DOMException ? error.name : "";
  if (QUOTA_ERROR_NAMES.includes(name)) {
    return new IgnifxError(CoreErrorCode.storageQuotaExceeded, "The browser refused the write: no quota left.", {
      cause: error,
      context: { backend: "indexeddb", operation },
      hint: "Ask the user to free space, or call navigator.storage.persist() before writing.",
    });
  }
  return new IgnifxError(CoreErrorCode.storageBackendFailed, `IndexedDB could not ${operation}.`, {
    cause: error,
    context: { backend: "indexeddb", operation, name },
    hint: "Private-browsing modes and blocked site data make IndexedDB unavailable.",
  });
}

/**
 * Settles when an IndexedDB request does.
 *
 * @typeParam T - What the request yields.
 * @param request - The request to await.
 * @returns Its result.
 */
async function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", (): void => {
      resolve(request.result);
    });
    request.addEventListener("error", (): void => {
      reject(request.error ?? new Error("The IndexedDB request failed."));
    });
  });
}

/**
 * Settles when a transaction commits or aborts.
 *
 * @param transaction - The transaction to await.
 * @returns A promise that resolves on `complete`.
 */
async function awaitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", (): void => {
      resolve();
    });
    transaction.addEventListener("error", (): void => {
      reject(transaction.error ?? new Error("The IndexedDB transaction failed."));
    });
    transaction.addEventListener("abort", (): void => {
      reject(transaction.error ?? new Error("The IndexedDB transaction aborted."));
    });
  });
}

/**
 * Opens `ignifx`, creating the `values` store if this origin has none.
 *
 * @returns The open connection.
 */
async function openDatabase(): Promise<IDBDatabase> {
  const first = await awaitOpen(indexedDB.open(DATABASE_NAME));
  if (first.objectStoreNames.contains(STORE_NAME)) {
    return first;
  }
  const version = first.version + 1;
  first.close();
  return awaitOpen(indexedDB.open(DATABASE_NAME, version));
}

/**
 * Settles when an open request does, creating the store when an upgrade runs.
 *
 * @param request - The open request.
 * @returns The connection.
 */
async function awaitOpen(request: IDBOpenDBRequest): Promise<IDBDatabase> {
  request.addEventListener("upgradeneeded", (): void => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME);
    }
  });
  return awaitRequest(request);
}

/**
 * Reads a stored value back out of what IndexedDB's structured clone returned.
 *
 * @param record - The record read from the store.
 * @returns The value, or `null` when the record is not one this backend wrote.
 */
function toStoredValue(record: unknown): StoredValue | null {
  if (typeof record !== "object" || record === null || !("kind" in record)) {
    return null;
  }
  if (record.kind === "json" && "json" in record && typeof record.json === "string") {
    return { kind: "json", json: record.json };
  }
  if (record.kind === "bytes" && "bytes" in record && record.bytes instanceof Uint8Array) {
    return { kind: "bytes", bytes: record.bytes };
  }
  return null;
}

/**
 * A store backed by the browser's IndexedDB.
 *
 * @example
 * ```ts
 * const app = await createApp({ canvas, storage: new IndexedDbStorageBackend() });
 * ```
 *
 * @public
 */
export class IndexedDbStorageBackend implements StorageBackend {
  /** The identifier that appears in error context. */
  readonly name = "indexeddb";

  /** The open connection, or the promise that is opening it. `null` until the first call. */
  #connection: Promise<IDBDatabase> | null = null;

  /**
   * Reads one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key.
   * @returns The value, or `null`.
   */
  async get(namespace: string, key: string): Promise<StoredValue | null> {
    const database = await this.#open("read a value");
    try {
      const store = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
      const record: unknown = await awaitRequest(store.get([namespace, key]));
      return record === undefined ? null : toStoredValue(record);
    } catch (error: unknown) {
      throw toStorageError(error, `read ${key}`);
    }
  }

  /**
   * Writes one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key.
   * @param value - The value.
   * @returns A promise that settles once the transaction commits.
   */
  async set(namespace: string, key: string, value: StoredValue): Promise<void> {
    const database = await this.#open("write a value");
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, [namespace, key]);
      await awaitTransaction(transaction);
    } catch (error: unknown) {
      throw toStorageError(error, `write ${key}`);
    }
  }

  /**
   * Removes one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key.
   * @returns A promise that settles once the transaction commits.
   */
  async delete(namespace: string, key: string): Promise<void> {
    const database = await this.#open("delete a value");
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete([namespace, key]);
      await awaitTransaction(transaction);
    } catch (error: unknown) {
      throw toStorageError(error, `delete ${key}`);
    }
  }

  /**
   * Lists one namespace's keys.
   *
   * @param namespace - The namespace path.
   * @param prefix - An optional key prefix.
   * @returns The matching keys, in ascending order.
   */
  async keys(namespace: string, prefix?: string): Promise<readonly string[]> {
    const database = await this.#open("list a namespace");
    try {
      const store = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
      // Array keys sort after every other key type, so `[namespace, []]` is above every
      // `[namespace, "…"]` and `[namespace]` is below all of them: one bounded range is exactly
      // this namespace, and IndexedDB returns it already sorted.
      const range = IDBKeyRange.bound([namespace], [namespace, []]);
      const raw: readonly IDBValidKey[] = await awaitRequest(store.getAllKeys(range));
      const found: string[] = [];
      for (let index = 0; index < raw.length; index += 1) {
        const entry = raw[index];
        const key = Array.isArray(entry) ? entry[1] : undefined;
        if (typeof key === "string" && (prefix === undefined || key.startsWith(prefix))) {
          found.push(key);
        }
      }
      return found;
    } catch (error: unknown) {
      throw toStorageError(error, `list ${namespace}`);
    }
  }

  /**
   * Empties one namespace.
   *
   * @param namespace - The namespace path.
   * @returns A promise that settles once the transaction commits.
   */
  async clear(namespace: string): Promise<void> {
    const database = await this.#open("clear a namespace");
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(IDBKeyRange.bound([namespace], [namespace, []]));
      await awaitTransaction(transaction);
    } catch (error: unknown) {
      throw toStorageError(error, `clear ${namespace}`);
    }
  }

  /** Closes the connection. The next call opens a new one. */
  dispose(): void {
    const connection = this.#connection;
    this.#connection = null;
    if (connection !== null) {
      void connection.then(
        (database: IDBDatabase): void => {
          database.close();
        },
        (): void => {
          // The connection never opened; there is nothing to close.
        },
      );
    }
  }

  /**
   * Opens the database once and reuses it.
   *
   * @param operation - What the caller was attempting, for the error message.
   * @returns The connection.
   */
  async #open(operation: string): Promise<IDBDatabase> {
    this.#connection ??= openDatabase();
    try {
      return await this.#connection;
    } catch (error: unknown) {
      this.#connection = null;
      throw toStorageError(error, operation);
    }
  }
}
