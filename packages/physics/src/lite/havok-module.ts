import HavokPhysics from "@babylonjs/havok";
import { PhysicsErrorCode, physicsError } from "../errors.js";

/**
 * Loading the Havok WebAssembly module (`docs/architecture/09-physics.md` §7, ADR-0003 Validation).
 *
 * `@babylonjs/havok@1.3.14`'s ESM build hard-codes `ENVIRONMENT_IS_WEB = true` and fetches its
 * `.wasm` with `fetch(scriptDirectory + path)`, so `locateFile` cannot help under Node — Node's
 * `fetch` refuses `file:` URLs. Emscripten's `wasmBinary` option is the supported escape and is what
 * this module always uses: the bytes are obtained first (from the caller, from `fetch`, or from
 * `node:fs`) and handed to the factory. `app.isHeadless` therefore only changes *where the bytes
 * come from*, exactly as the Phase 4 brief requires.
 *
 * The `@babylonjs/havok` import lives here because this file is under `src/lite/`, the only place
 * `ignifx/no-lite-outside-adapter` and dependency-cruiser allow a native backend.
 *
 * Everything here is `@internal`.
 */

/**
 * The unhashed file name the Vite plugin copies into the public asset path, and therefore the
 * address `app.assets.resolveUrl` answers for.
 *
 * @remarks
 * Extension public assets are copied by **base name** (`packages/vite-plugin/src/plugin.ts`,
 * `generateBundle`), into the same directory the default asset root points at, so the address is the
 * bare file name and not a package-scoped path.
 *
 * @internal
 */
export const HAVOK_WASM_FILE_NAME = "HavokPhysics.wasm";

/** Where the Havok bytes come from. */
export interface HavokSource {
  /** An already-instantiated module, which wins over everything else. */
  readonly module?: unknown;
  /** The `.wasm` bytes, for a caller that read them itself. */
  readonly wasmBinary?: ArrayBuffer;
  /** The URL or file path to read the bytes from. */
  readonly url?: string;
}

/**
 * Instantiates Havok.
 *
 * @param source - An instantiated module, explicit bytes, or a URL to read them from.
 * @returns The module, typed as `unknown` because Lite types its own parameter as `any`.
 * @throws IgnifxError with code `IGX-0903` when the bytes cannot be obtained or the module fails to
 * instantiate.
 *
 * @example
 * ```ts
 * const havok = await loadHavok({ url: app.assets.resolveUrl(HAVOK_WASM_FILE_NAME) });
 * ```
 *
 * @internal
 */
export async function loadHavok(source: HavokSource): Promise<unknown> {
  if (source.module !== undefined && source.module !== null) {
    return source.module;
  }
  const url = source.url ?? HAVOK_WASM_FILE_NAME;
  const wasmBinary = source.wasmBinary ?? (await readWasmBytes(url));
  try {
    return await HavokPhysics({ wasmBinary });
  } catch (cause: unknown) {
    throw physicsError(PhysicsErrorCode.havokUnavailable, "Havok failed to instantiate from the supplied bytes.", {
      context: { url },
      hint: "Check that HavokPhysics.wasm matches the installed @babylonjs/havok version.",
      cause,
    });
  }
}

/**
 * Reads the `.wasm` bytes, preferring `fetch` and falling back to the file system under Node.
 *
 * @param url - The URL or path.
 * @returns The bytes as a plain `ArrayBuffer`, which is what Emscripten wants.
 * @throws IgnifxError with code `IGX-0903` when neither route produces bytes.
 */
async function readWasmBytes(url: string): Promise<ArrayBuffer> {
  let fetchFailure: unknown = null;
  if (typeof globalThis.fetch === "function") {
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) {
        return await response.arrayBuffer();
      }
      fetchFailure = new Error(`${String(response.status)} ${response.statusText}`);
    } catch (cause: unknown) {
      fetchFailure = cause;
    }
  }
  const fromDisk = await readFromDisk(url);
  if (fromDisk !== null) {
    return fromDisk;
  }
  const fromPackage = await readFromPackage();
  if (fromPackage !== null) {
    return fromPackage;
  }
  throw physicsError(PhysicsErrorCode.havokUnavailable, "The Havok WebAssembly bytes could not be read.", {
    context: { url },
    hint: 'Set physics({ havokWasm: "<url>" }) or hand physics({ wasmBinary }) the bytes yourself.',
    ...(fetchFailure === null ? {} : { cause: fetchFailure }),
  });
}

/**
 * Reads a file through `node:fs` when the host is Node, and reports `null` everywhere else.
 *
 * @remarks
 * The specifier is held in a constant so that browser bundlers leave the import alone: a bundler
 * only rewrites a `import("…")` whose argument is a string literal, and this branch is unreachable
 * in a browser anyway.
 *
 * @param path - The file path.
 * @returns The bytes, or `null` when there is no file system to read from, or the file is
 * unreadable. A browser fails the import itself, which is the same answer.
 */
async function readFromDisk(path: string): Promise<ArrayBuffer | null> {
  try {
    const specifier = NODE_FS_SPECIFIER;
    // A dynamic import with a non-literal specifier is
    // typed `any`, and {@link NodeFileSystem} is the one method of it this branch calls.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const fs = (await import(/* @vite-ignore */ specifier)) as NodeFileSystem;
    const bytes = await fs.readFile(path);
    // A Node `Buffer` is a view into a pooled `ArrayBuffer`, so copy out exactly this file's bytes
    // rather than handing Emscripten a window onto the pool.
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
  } catch {
    return null;
  }
}

/** The one `node:fs/promises` member this module calls. */
interface NodeFileSystem {
  /**
   * Reads a whole file.
   *
   * @param file - The path.
   * @returns Its bytes.
   */
  readFile(file: string): Promise<Uint8Array>;
}

/** The `node:fs/promises` specifier, held in a constant so bundlers do not follow it. */
const NODE_FS_SPECIFIER = "node:fs/promises";

/** Where `@babylonjs/havok@1.3.14` keeps the binary its ESM build would otherwise `fetch`. */
const HAVOK_PACKAGE_WASM = "@babylonjs/havok/lib/esm/HavokPhysics.wasm";

/**
 * Reads the binary straight out of the installed `@babylonjs/havok` package, which is what makes a
 * headless Node app work with no configuration at all: `app.isHeadless` only changes *where the
 * bytes come from* (Phase 4 brief), and under Node the answer is the package itself.
 *
 * @returns The bytes, or `null` when `import.meta.resolve` is unavailable or the package cannot be
 * resolved.
 */
async function readFromPackage(): Promise<ArrayBuffer | null> {
  try {
    const resolved = import.meta.resolve(HAVOK_PACKAGE_WASM);
    return await readFromDisk(resolved.startsWith("file://") ? fileUrlToPath(resolved) : resolved);
  } catch {
    return null;
  }
}

/**
 * Turns a `file:` URL into a path `node:fs` accepts.
 *
 * @param url - The `file:` URL.
 * @returns The decoded path.
 */
function fileUrlToPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname);
}
