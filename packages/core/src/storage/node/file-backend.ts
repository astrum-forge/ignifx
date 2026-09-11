import { CoreErrorCode } from "../../errors/error-codes.js";
import { IgnifxError } from "../../errors/ignifx-error.js";
import { decodeStorageFileName, encodeStorageFileName } from "../file-names.js";
import type { StorageBackend, StoredValue } from "../backend.js";

/**
 * The directory-backed storage backend: `createApp({ storage: { directory } })` under Node
 * (`docs/architecture/14-platform-electron.md` §2 and §5). It writes
 * `<directory>/<namespace>/<encoded-key>.json` for JSON values and `….bin` for byte values, with
 * the key encoding of `../file-names.ts`.
 *
 * ## Why the fs module is loaded through a variable specifier
 *
 * `@ignifx/core` compiles without `@types/node` — its `tsconfig.json` declares
 * `types: ["@webgpu/types"]`, because the package is a browser library and its published `.d.ts`
 * must not reference Node types. A literal `import("node:fs/promises")` therefore does not
 * type-check, and a static import would put a Node built-in into the module graph every browser
 * bundler has to externalize. Loading through a `string` specifier solves both: TypeScript asks no
 * questions, no bundler follows it, and this file costs a browser build nothing. What is lost is
 * TypeScript's own view of `node:fs/promises`, so {@link FileSystemApi} restates the six calls the
 * backend makes; Node's real signatures are wider, and structurally compatible.
 *
 * ## Atomicity
 *
 * Every write goes to `<encoded-key>.<random>.tmp` in the same directory and is then `rename`d over
 * the destination. `rename` within one file system is atomic on POSIX and on Windows' NTFS, so a
 * reader sees either the whole previous value or the whole new one — never a half-written save
 * after a crash or a power cut. Temporary files are named so that the backend's `keys()`
 * skips them, and a crash leaves at most one stray `.tmp` per interrupted write.
 */

/**
 * The `node:fs/promises` calls this backend makes. Node's own signatures are wider, so the real
 * module satisfies it structurally; a test supplies a fake to exercise the failure paths a real
 * file system will not produce on demand.
 *
 * @internal
 */
export interface FileSystemApi {
  /**
   * Creates a directory and its parents.
   *
   * @param path - The directory to create.
   * @param options - Node's options bag.
   * @param options.recursive - Always `true`: parents are created too.
   */
  mkdir(path: string, options: { readonly recursive: true }): Promise<unknown>;

  /**
   * Reads a whole file.
   *
   * @param path - The file to read.
   */
  readFile(path: string): Promise<Uint8Array>;

  /**
   * Writes a whole file.
   *
   * @param path - The file to write.
   * @param data - The octets.
   */
  writeFile(path: string, data: Uint8Array): Promise<void>;

  /**
   * Moves a file over another, atomically.
   *
   * @param from - The existing path.
   * @param to - The destination path.
   */
  rename(from: string, to: string): Promise<void>;

  /**
   * Removes a file, tolerating its absence.
   *
   * @param path - The file to remove.
   * @param options - Node's options bag.
   * @param options.force - Always `true`: an absent file is not an error.
   * @param options.recursive - Always `true`, so a directory left by an older build also goes.
   */
  rm(path: string, options: { readonly force: true; readonly recursive: true }): Promise<void>;

  /**
   * Lists a directory.
   *
   * @param path - The directory to list.
   */
  readdir(path: string): Promise<readonly string[]>;
}

/**
 * Options accepted by {@link createFileStorageBackend}.
 *
 * @public
 */
export interface FileStorageOptions {
  /**
   * The root directory. It is created on first write, together with every namespace directory
   * under it. Under Electron this is `app.getPath("userData")`; in a test it is a temporary
   * directory.
   */
  readonly directory: string;
}

/** The extension a JSON value is written under. */
const JSON_EXTENSION = ".json";

/** The extension a byte value is written under. */
const BYTES_EXTENSION = ".bin";

/** The suffix an in-progress write carries until its `rename` lands. */
const TEMPORARY_EXTENSION = ".tmp";

/** The `errno` codes that mean "the host has no room left". */
// oxlint-disable-next-line unicorn/prefer-set-has -- a module-scope Set is an import-time allocation (CONSTITUTION.md 3.5).
const OUT_OF_SPACE_CODES: readonly string[] = ["ENOSPC", "EDQUOT", "EFBIG"];

/** The `errno` codes that mean "there is nothing there", which is an absence and not a failure. */
// oxlint-disable-next-line unicorn/prefer-set-has -- a module-scope Set is an import-time allocation (CONSTITUTION.md 3.5).
const ABSENT_CODES: readonly string[] = ["ENOENT", "ENOTDIR"];

/** The radix the temporary-file suffix is written in. */
const SUFFIX_RADIX = 36;

/** How many characters of the random suffix to keep. */
const SUFFIX_LENGTH = 10;

/**
 * Reads the `errno` string off whatever a Node file-system call rejected with.
 *
 * @param error - The rejection value.
 * @returns The code, or `""` when the value carries none.
 */
function errnoOf(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "";
  }
  const code: unknown = error.code;
  return typeof code === "string" ? code : "";
}

/**
 * Wraps a file-system failure in the storage error the backend contract promises.
 *
 * @param error - The rejection value.
 * @param operation - What was being attempted, for the message.
 * @param path - The path involved.
 * @returns The error to throw.
 */
function toStorageError(error: unknown, operation: string, path: string): IgnifxError {
  const code = errnoOf(error);
  if (OUT_OF_SPACE_CODES.includes(code)) {
    return new IgnifxError(CoreErrorCode.storageQuotaExceeded, "The storage backend is out of space.", {
      cause: error,
      context: { backend: "file", operation, code },
      hint: "Free space on the volume, or write to a different directory.",
    });
  }
  return new IgnifxError(CoreErrorCode.storageBackendFailed, `The file storage backend could not ${operation}.`, {
    cause: error,
    context: { backend: "file", operation, path, code },
    hint: "Check that the storage directory exists and is writable.",
  });
}

/**
 * A store backed by a directory tree.
 *
 * @remarks
 * Constructed by {@link createFileStorageBackend}, which loads the file-system module first; the
 * class itself is not exported, so nothing in the published `.d.ts` mentions Node.
 */
class FileStorageBackend implements StorageBackend {
  /** The identifier that appears in error context. */
  readonly name = "file";

  /** The file-system calls, loaded once by the factory. */
  readonly #fs: FileSystemApi;

  /** The root directory. */
  readonly #root: string;

  /** Distinguishes concurrent temporary files written by this backend in one millisecond. */
  #sequence = 0;

  /**
   * Builds a backend over an already-loaded file-system module.
   *
   * @param fs - The file-system calls.
   * @param directory - The root directory.
   */
  constructor(fs: FileSystemApi, directory: string) {
    this.#fs = fs;
    this.#root = directory;
  }

  /**
   * Reads one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key.
   * @returns The value, or `null` when neither a `.json` nor a `.bin` file exists for the key.
   */
  async get(namespace: string, key: string): Promise<StoredValue | null> {
    const base = this.#pathOf(namespace, key);
    const json = await this.#readOrNull(`${base}${JSON_EXTENSION}`);
    if (json !== null) {
      return { kind: "json", json: new TextDecoder().decode(json) };
    }
    const raw = await this.#readOrNull(`${base}${BYTES_EXTENSION}`);
    // Node hands back a `Buffer`, which is a `Uint8Array` subclass drawn from a shared pool. The
    // contract promises a plain `Uint8Array` the caller owns, so the octets are copied out.
    return raw === null ? null : { kind: "bytes", bytes: new Uint8Array(raw) };
  }

  /**
   * Writes one value atomically, and removes the file the other kind would have used.
   *
   * @param namespace - The namespace path.
   * @param key - The key.
   * @param value - The value.
   * @returns A promise that settles once the rename has landed.
   */
  async set(namespace: string, key: string, value: StoredValue): Promise<void> {
    const directory = this.#directoryOf(namespace);
    const base = `${directory}/${encodeStorageFileName(key)}`;
    const isJson = value.kind === "json";
    const destination = `${base}${isJson ? JSON_EXTENSION : BYTES_EXTENSION}`;
    const stale = `${base}${isJson ? BYTES_EXTENSION : JSON_EXTENSION}`;
    this.#sequence += 1;
    const suffix = `${Date.now().toString(SUFFIX_RADIX)}${this.#sequence.toString(SUFFIX_RADIX)}${Math.random().toString(SUFFIX_RADIX).slice(2, SUFFIX_LENGTH)}`;
    const temporary = `${base}.${suffix}${TEMPORARY_EXTENSION}`;
    const bytes = value.kind === "json" ? new TextEncoder().encode(value.json) : value.bytes;
    try {
      await this.#fs.mkdir(directory, { recursive: true });
      await this.#fs.writeFile(temporary, bytes);
      await this.#fs.rename(temporary, destination);
    } catch (error: unknown) {
      await this.#removeQuietly(temporary);
      throw toStorageError(error, `write ${key}`, destination);
    }
    await this.#removeQuietly(stale);
  }

  /**
   * Removes one value, whichever kind it was stored as.
   *
   * @param namespace - The namespace path.
   * @param key - The key.
   * @returns A promise that settles once both candidate files are gone.
   */
  async delete(namespace: string, key: string): Promise<void> {
    const base = this.#pathOf(namespace, key);
    await this.#remove(`${base}${JSON_EXTENSION}`, key);
    await this.#remove(`${base}${BYTES_EXTENSION}`, key);
  }

  /**
   * Lists one namespace's keys.
   *
   * @param namespace - The namespace path.
   * @param prefix - An optional key prefix.
   * @returns The matching keys, sorted ascending. Files that are not encoded keys — a stray
   * `README`, an interrupted `.tmp` — are skipped rather than reported.
   */
  async keys(namespace: string, prefix?: string): Promise<readonly string[]> {
    const directory = this.#directoryOf(namespace);
    let entries: readonly string[];
    try {
      entries = await this.#fs.readdir(directory);
    } catch (error: unknown) {
      if (ABSENT_CODES.includes(errnoOf(error))) {
        return [];
      }
      throw toStorageError(error, `list ${namespace}`, directory);
    }
    const found: string[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(JSON_EXTENSION) && !entry.endsWith(BYTES_EXTENSION)) {
        continue;
      }
      const key = decodeStorageFileName(entry.slice(0, entry.lastIndexOf(".")));
      if (key !== null && (prefix === undefined || key.startsWith(prefix))) {
        found.push(key);
      }
    }
    return found.toSorted();
  }

  /**
   * Empties one namespace by removing its directory.
   *
   * @param namespace - The namespace path.
   * @returns A promise that settles once the directory is gone.
   */
  async clear(namespace: string): Promise<void> {
    const directory = this.#directoryOf(namespace);
    try {
      await this.#fs.rm(directory, { force: true, recursive: true });
    } catch (error: unknown) {
      throw toStorageError(error, `clear ${namespace}`, directory);
    }
  }

  /**
   * The directory one namespace's files live in.
   *
   * @param namespace - The namespace path, `"saves/coop"`.
   * @returns The absolute directory path, with every segment encoded.
   */
  #directoryOf(namespace: string): string {
    let path = this.#root;
    for (const segment of namespace.split("/")) {
      path += `/${encodeStorageFileName(segment)}`;
    }
    return path;
  }

  /**
   * The extension-less path one key's file has.
   *
   * @param namespace - The namespace path.
   * @param key - The key.
   * @returns The path without `.json` or `.bin`.
   */
  #pathOf(namespace: string, key: string): string {
    return `${this.#directoryOf(namespace)}/${encodeStorageFileName(key)}`;
  }

  /**
   * Reads a file, treating its absence as `null`.
   *
   * @param path - The file to read.
   * @returns The octets, or `null`.
   */
  async #readOrNull(path: string): Promise<Uint8Array | null> {
    try {
      return await this.#fs.readFile(path);
    } catch (error: unknown) {
      if (ABSENT_CODES.includes(errnoOf(error))) {
        return null;
      }
      throw toStorageError(error, "read a value", path);
    }
  }

  /**
   * Removes a file, reporting a real failure.
   *
   * @param path - The file to remove.
   * @param key - The key it belongs to, for the message.
   * @returns A promise that settles once the file is gone.
   */
  async #remove(path: string, key: string): Promise<void> {
    try {
      await this.#fs.rm(path, { force: true, recursive: true });
    } catch (error: unknown) {
      throw toStorageError(error, `delete ${key}`, path);
    }
  }

  /**
   * Removes a file and swallows every failure — the cleanup path, where a second error would hide
   * the first one.
   *
   * @param path - The file to remove.
   * @returns A promise that always settles.
   */
  async #removeQuietly(path: string): Promise<void> {
    try {
      await this.#fs.rm(path, { force: true, recursive: true });
    } catch {
      // Cleanup is best effort: a stray temporary file is skipped by `keys()` and overwritten by
      // the next successful write.
    }
  }
}

/**
 * Builds a storage backend over an already-loaded file-system module.
 *
 * @remarks
 * The seam {@link createFileStorageBackend} sits on, and the one the unit tests inject a fake
 * through: `ENOSPC`, an unreadable directory, and a rejection that carries no `errno` at all are
 * all failures a real file system will not produce on request.
 *
 * @param fs - The `node:fs/promises` subset the backend calls.
 * @param directory - The root directory.
 * @returns The backend.
 *
 * @internal
 */
export function createFileSystemBackend(fs: FileSystemApi, directory: string): StorageBackend {
  return new FileStorageBackend(fs, directory);
}

/**
 * Builds a storage backend over a directory (`docs/architecture/14-platform-electron.md` §5).
 *
 * @remarks
 * Node only: the factory loads `node:fs/promises` and rejects on a host that has none. It is what
 * `createApp({ storage: { directory } })` calls, and it is exported so that tooling — `ignifx bake`,
 * a future authoritative server — can build one without an app.
 *
 * @param options - The root directory.
 * @returns The backend.
 * @throws IgnifxError with code `IGX-1425` when the host exposes no `node:fs/promises`.
 *
 * @example
 * ```ts
 * const app = await createApp({ headless: true, storage: { directory: "./.saves" } });
 * await app.storage.namespace("saves").set("slot1", { level: 3 });
 * ```
 *
 * @public
 */
export async function createFileStorageBackend(options: FileStorageOptions): Promise<StorageBackend> {
  // The specifier is a variable on purpose: see this module's header. TypeScript types the result
  // as `any`, and the assertion below is the single boundary where it becomes typed again.
  const specifier = "node:fs/promises";
  let loaded: unknown;
  try {
    // `@vite-ignore` keeps the warning out of every game's build log: a bundler cannot analyse a
    // computed specifier, and this one is meant to stay a runtime import.
    loaded = await import(/* @vite-ignore */ specifier);
  } catch (cause: unknown) {
    throw new IgnifxError(CoreErrorCode.storageBackendFailed, "This host has no node:fs/promises.", {
      cause,
      context: { backend: "file" },
      hint: "A directory storage backend runs under Node or Electron's main process only.",
    });
  }
  // A dynamic import with a computed specifier has no
  // static type, and `FileSystemApi` is this module's declaration of what Node hands back.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return createFileSystemBackend(loaded as FileSystemApi, options.directory);
}
