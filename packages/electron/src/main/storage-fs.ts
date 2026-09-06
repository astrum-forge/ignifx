import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { QUOTA_MESSAGE_PREFIX } from "../host-contract.js";
import { decodeStorageFileName, encodeStorageFileName, storageDirectoryFor } from "./storage-names.js";
import type { HostStoredValue } from "../host-contract.js";

/**
 * The file-system store a desktop build's `app.storage` writes through
 * (`docs/architecture/14-platform-electron.md` §2). It runs in the **main** process: the renderer
 * holds a `StorageBackend` that forwards over the preload bridge, so a sandboxed renderer never
 * touches `fs`. The names it writes are `./storage-names.ts`'s, which are `@ignifx/core`'s.
 */

/**
 * The extension a JSON value is written under.
 *
 * @public
 */
export const JSON_EXTENSION = ".json";

/**
 * The extension a byte value is written under.
 *
 * @public
 */
export const BYTES_EXTENSION = ".bin";

/**
 * Reads the `code` of an unknown thrown value without asserting its type.
 *
 * @param error - The caught value.
 * @returns The `errno` code, or `null`.
 */
function errorCodeOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/**
 * Reports whether a caught failure means "there is no such file".
 *
 * @param error - The caught value.
 * @returns `true` for `ENOENT` and `ENOTDIR`.
 *
 * @public
 */
export function isMissingFileError(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Reports whether a caught failure means the disk or the user's quota is full.
 *
 * @remarks
 * The renderer turns this into `IGX-1424`, which is the code `StorageBackend`'s rule 8 reserves for
 * "out of quota"; everything else becomes `IGX-1425`.
 *
 * @param error - The caught value.
 * @returns `true` for `ENOSPC`, `EDQUOT`, and `EFBIG`.
 *
 * @public
 */
export function isQuotaError(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === "ENOSPC" || code === "EDQUOT" || code === "EFBIG";
}

/**
 * Swallows the "already gone" failure of an `unlink` meant only to tidy up.
 *
 * @param error - The caught value.
 */
function ignoreMissing(error: unknown): void {
  if (!isMissingFileError(error)) {
    throw error;
  }
}

/**
 * Re-throws a file-system failure, marking the ones that mean "out of space".
 *
 * @param error - The caught value.
 * @throws Always: the marked `Error` for a quota failure, the original value otherwise.
 */
function rethrowStorageError(error: unknown): never {
  if (isQuotaError(error)) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${QUOTA_MESSAGE_PREFIX}${message}`, { cause: error });
  }
  throw error;
}

/**
 * The file-system store a desktop build's `app.storage` is backed by.
 *
 * @remarks
 * It is not itself a `StorageBackend`: that contract is a renderer-side interface, and this object
 * lives in the main process behind the IPC bridge. `renderer/storage-backend.ts` holds the
 * `StorageBackend` that calls it.
 *
 * @example
 * ```ts
 * const storage = new FileStorage(app.getPath("userData"));
 * await storage.set("saves", "slot1", { kind: "json", json: '{"level":3}' });
 * await storage.keys("saves"); // ["slot1"]
 * ```
 *
 * @public
 */
export class FileStorage {
  /** The `userData` directory every namespace hangs below. */
  readonly root: string;

  /**
   * Builds a store rooted at a directory.
   *
   * @param root - The `userData` directory, from `app.getPath("userData")`.
   */
  constructor(root: string) {
    this.root = root;
  }

  /**
   * Reads one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside it.
   * @returns The stored value, or `null` when there is none.
   */
  async get(namespace: string, key: string): Promise<HostStoredValue | null> {
    const stem = `${storageDirectoryFor(this.root, namespace)}/${encodeStorageFileName(key)}`;
    const text = await this.#readOrNull(`${stem}${JSON_EXTENSION}`);
    if (text !== null) {
      return { kind: "json", json: new TextDecoder().decode(text) };
    }
    const bytes = await this.#readOrNull(`${stem}${BYTES_EXTENSION}`);
    return bytes === null ? null : { kind: "bytes", bytes };
  }

  /**
   * Writes one value, replacing whatever was there under either extension.
   *
   * @param namespace - The namespace path, created on demand.
   * @param key - The key inside it.
   * @param value - The JSON text or the octets to persist.
   * @returns A promise that settles once the value is durable.
   */
  async set(namespace: string, key: string, value: HostStoredValue): Promise<void> {
    const directory = storageDirectoryFor(this.root, namespace);
    const stem = `${directory}/${encodeStorageFileName(key)}`;
    const [wanted, stale] =
      value.kind === "json"
        ? ([`${stem}${JSON_EXTENSION}`, `${stem}${BYTES_EXTENSION}`] as const)
        : ([`${stem}${BYTES_EXTENSION}`, `${stem}${JSON_EXTENSION}`] as const);
    const bytes = value.kind === "json" ? new TextEncoder().encode(value.json) : value.bytes;
    try {
      await mkdir(directory, { recursive: true });
      await this.#writeAtomically(wanted, bytes);
    } catch (error) {
      rethrowStorageError(error);
    }
    // A key that changes kind must not leave the other file behind, or `get` would find the stale
    // one first the next time round.
    await unlink(stale).catch(ignoreMissing);
  }

  /**
   * Removes one value under either extension.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside it.
   * @returns A promise that settles once the value is gone.
   */
  async delete(namespace: string, key: string): Promise<void> {
    const stem = `${storageDirectoryFor(this.root, namespace)}/${encodeStorageFileName(key)}`;
    await Promise.all([
      unlink(`${stem}${JSON_EXTENSION}`).catch(ignoreMissing),
      unlink(`${stem}${BYTES_EXTENSION}`).catch(ignoreMissing),
    ]);
  }

  /**
   * Lists the keys of one namespace.
   *
   * @param namespace - The namespace path.
   * @param prefix - When given, only keys starting with it are returned.
   * @returns The matching keys, sorted ascending; `[]` for an unknown namespace.
   */
  async keys(namespace: string, prefix?: string): Promise<readonly string[]> {
    let entries: readonly string[];
    try {
      entries = await readdir(storageDirectoryFor(this.root, namespace));
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const keys: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const stem = stemOf(entries[index] ?? "");
      if (stem === null) {
        continue;
      }
      const key = decodeStorageFileName(stem);
      if (key === null) {
        continue;
      }
      if (prefix === undefined || key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    // Two files can decode to one key only if a `.json` and a `.bin` survived together, which
    // `set` prevents; de-duplicating anyway keeps a hand-edited directory from listing twice.
    const unique = [...new Set(keys)];
    unique.sort();
    return unique;
  }

  /**
   * Removes every value of one namespace, leaving other namespaces untouched.
   *
   * @remarks
   * The value files are removed rather than the directory, so a nested namespace — `saves/coop`
   * under `saves` — survives its parent being cleared, which rule 7 requires.
   *
   * @param namespace - The namespace path.
   * @returns A promise that settles once the namespace is empty.
   */
  async clear(namespace: string): Promise<void> {
    const directory = storageDirectoryFor(this.root, namespace);
    let entries: readonly string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }
      throw error;
    }
    await Promise.all(
      entries
        .filter((entry: string): boolean => stemOf(entry) !== null)
        .map(async (entry: string): Promise<void> => unlink(`${directory}/${entry}`).catch(ignoreMissing)),
    );
  }

  /**
   * Reads a file, treating its absence as `null`.
   *
   * @param path - The file to read.
   * @returns The octets, or `null`.
   */
  async #readOrNull(path: string): Promise<Uint8Array | null> {
    try {
      const buffer = await readFile(path);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Writes a file atomically: to a sibling temporary name, then renamed over the target.
   *
   * @remarks
   * `rename` within one directory is atomic on every file system ignifx targets, which is what
   * satisfies rule 5 of the `StorageBackend` contract — a reader sees the whole previous value or
   * the whole new one, never a partial write.
   *
   * @param path - The final path.
   * @param data - The bytes to write.
   * @returns A promise that settles once the value is in place.
   */
  async #writeAtomically(path: string, data: Uint8Array): Promise<void> {
    const temporary = `${path}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, data);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch((): void => {
        // The temporary is already gone, or its directory is; either way the original failure is
        // the one worth reporting.
      });
      throw error;
    }
  }
}

/**
 * The stem of a storage file name, or `null` when the entry is not one.
 *
 * @param entry - A directory entry name.
 * @returns The stem without its extension, or `null` for a temporary file, a subdirectory, or
 * anything else that is not a stored value.
 */
function stemOf(entry: string): string | null {
  if (entry.endsWith(JSON_EXTENSION)) {
    return entry.slice(0, -JSON_EXTENSION.length);
  }
  if (entry.endsWith(BYTES_EXTENSION)) {
    return entry.slice(0, -BYTES_EXTENSION.length);
  }
  return null;
}
