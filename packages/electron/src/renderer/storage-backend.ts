import { IgnifxError } from "@ignifx/core";
import { QUOTA_MESSAGE_PREFIX } from "../host-contract.js";
import { hostCallError } from "./host.js";
import type { HostStoredValue, IgnifxHost } from "../host-contract.js";
import type { StorageBackend, StoredValue } from "@ignifx/core";

/**
 * Forward storage operations through the preload bridge because the renderer has no filesystem access.
 * Use core's storage error codes (`IGX-1424` quota, `IGX-1426` unreadable data, `IGX-1425` other
 * failures) so callers handle errors the same way on every platform.
 */

/**
 * `IGX-1424` — the host is out of quota.
 *
 * @remarks
 * Quoted as a literal because `@ignifx/core`'s `CoreErrorCode` table is not reachable from an
 * extension by design (`04-extensions.md` §3): an extension owns its own codes and is handed
 * core's as documented constants.
 *
 * @public
 */
export const STORAGE_QUOTA_CODE = "IGX-1424";

/**
 * `IGX-1425` — the backend failed for any other reason.
 *
 * @public
 */
export const STORAGE_BACKEND_FAILED_CODE = "IGX-1425";

/**
 * `IGX-1426` — a stored value could not be read back.
 *
 * @public
 */
export const STORAGE_VALUE_CORRUPT_CODE = "IGX-1426";

/**
 * The name this backend reports, as `StorageBackend.name` requires.
 *
 * @public
 */
export const ELECTRON_STORAGE_BACKEND_NAME = "electron-file";

/**
 * Turns a bridge rejection into the `IgnifxError` the contract requires.
 *
 * @param operation - What was being attempted, for example `"set saves/slot1"`.
 * @param error - What the bridge rejected with.
 * @returns The error to reject with.
 */
function storageError(operation: string, error: unknown): IgnifxError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(QUOTA_MESSAGE_PREFIX)) {
    return new IgnifxError(
      STORAGE_QUOTA_CODE,
      `The ${ELECTRON_STORAGE_BACKEND_NAME} storage backend has no quota left for ${operation}.`,
      {
        context: { backend: ELECTRON_STORAGE_BACKEND_NAME, operation },
        hint: "Free some disk space, or write a smaller value.",
        cause: error,
      },
    );
  }
  return new IgnifxError(
    STORAGE_BACKEND_FAILED_CODE,
    `The ${ELECTRON_STORAGE_BACKEND_NAME} storage backend could not ${operation}.`,
    { context: { backend: ELECTRON_STORAGE_BACKEND_NAME, operation }, cause: error },
  );
}

/**
 * Narrows what came back over the bridge to a {@link StoredValue}.
 *
 * @remarks
 * The bridge is trusted code, but the *file* behind it is not: a save edited by hand, truncated by
 * a full disk, or written by a different version is exactly the case `IGX-1426` exists for.
 *
 * @param value - What the bridge returned.
 * @param operation - What was being attempted, for the failure message.
 * @returns The value, or `null` when the key was absent.
 * @throws An `IgnifxError` with code `IGX-1426` when the value is neither shape.
 */
function narrowStoredValue(value: HostStoredValue | null, operation: string): StoredValue | null {
  if (value === null) {
    return null;
  }
  if (value.kind === "json" && typeof value.json === "string") {
    return { kind: "json", json: value.json };
  }
  if (value.kind === "bytes" && value.bytes instanceof Uint8Array) {
    return { kind: "bytes", bytes: value.bytes };
  }
  throw new IgnifxError(STORAGE_VALUE_CORRUPT_CODE, `The value read by ${operation} could not be read back.`, {
    context: { backend: ELECTRON_STORAGE_BACKEND_NAME, key: operation },
  });
}

/**
 * `app.storage`'s desktop backend: the preload bridge, wearing core's `StorageBackend` interface.
 *
 * @example
 * ```ts
 * const backend = new ElectronStorageBackend(window.ignifxHost);
 * await backend.set("saves", "slot1", { kind: "json", json: '{"level":3}' });
 * ```
 *
 * @public
 */
export class ElectronStorageBackend implements StorageBackend {
  /** The identifier that appears in error context. */
  readonly name: string = ELECTRON_STORAGE_BACKEND_NAME;

  /** The bridge every call is forwarded over. */
  readonly #host: IgnifxHost;

  /**
   * Builds a backend over a bridge.
   *
   * @param host - The validated `window.ignifxHost`.
   */
  constructor(host: IgnifxHost) {
    this.#host = host;
  }

  /**
   * Reads one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside it.
   * @returns The stored value, or `null` when the namespace has no such key.
   */
  async get(namespace: string, key: string): Promise<StoredValue | null> {
    const operation = `get ${namespace}/${key}`;
    let value: HostStoredValue | null;
    try {
      value = await this.#host.storage.get(namespace, key);
    } catch (error) {
      throw storageError(operation, hostCallError("storage.get", error));
    }
    return narrowStoredValue(value, operation);
  }

  /**
   * Writes one value, replacing whatever was there.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside it.
   * @param value - The JSON text or the octets to persist.
   * @returns A promise that settles once the value is durable.
   */
  async set(namespace: string, key: string, value: StoredValue): Promise<void> {
    try {
      // The bytes are copied before they cross: `contextBridge` clones, but a caller that reuses its
      // buffer while the write is in flight would otherwise be writing into the message.
      const wire: HostStoredValue =
        value.kind === "json" ? { kind: "json", json: value.json } : { kind: "bytes", bytes: value.bytes.slice() };
      await this.#host.storage.set(namespace, key, wire);
    } catch (error) {
      throw storageError(`set ${namespace}/${key}`, error);
    }
  }

  /**
   * Removes one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside it.
   * @returns A promise that settles once the value is gone.
   */
  async delete(namespace: string, key: string): Promise<void> {
    try {
      await this.#host.storage.delete(namespace, key);
    } catch (error) {
      throw storageError(`delete ${namespace}/${key}`, error);
    }
  }

  /**
   * Lists the keys of one namespace.
   *
   * @param namespace - The namespace path.
   * @param prefix - When given, only keys starting with it are returned.
   * @returns The matching keys, sorted ascending; `[]` for an unknown namespace.
   */
  async keys(namespace: string, prefix?: string): Promise<readonly string[]> {
    try {
      return await this.#host.storage.keys(namespace, prefix);
    } catch (error) {
      throw storageError(`list ${namespace}`, error);
    }
  }

  /**
   * Removes every value of one namespace.
   *
   * @param namespace - The namespace path.
   * @returns A promise that settles once the namespace is empty.
   */
  async clear(namespace: string): Promise<void> {
    try {
      await this.#host.storage.clear(namespace);
    } catch (error) {
      throw storageError(`clear ${namespace}`, error);
    }
  }
}
