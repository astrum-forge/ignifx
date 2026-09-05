import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Everything the suites need off the file system: the Havok WebAssembly bytes, the instantiated
 * module, and the installed Babylon Lite version the ADR-0013 layout guard pins.
 *
 * It lives under `test/lite/fixtures/` because `@babylonjs/havok` is a native backend and the
 * adapter rule (coding standards §4, dependency-cruiser's `no-native-backend-outside-adapter`)
 * confines it to `src/lite/**` and `test/lite/**`. Every other suite reaches it through the harness.
 *
 * Node built-ins are typed here because `test/tsconfig.json` (the type-aware linter's discovery
 * shim, as in `packages/core/test/`) carries `types: ["node"]`; without that file the linter
 * checked test files against the workspace root config and saw `node:fs` as an error type.
 */

/** The Havok module, instantiated once per process because it costs about a second. */
let cached: Promise<unknown> | null = null;

/**
 * Loads the Havok WebAssembly module under Node from the bytes on disk, the way ADR-0003's
 * Validation section records: `@babylonjs/havok`'s ESM build cannot `fetch` a `file:` URL, and
 * Emscripten's `wasmBinary` is the supported escape.
 *
 * @returns The instantiated module, shared by every suite in the process.
 */
export function loadHavokForTests(): Promise<unknown> {
  cached ??= instantiate();
  return cached;
}

/**
 * The `HavokPhysics.wasm` bytes, read straight out of the installed package.
 *
 * @returns A plain `ArrayBuffer`, which is what Emscripten's `wasmBinary` option wants.
 */
export function havokWasmBytes(): ArrayBuffer {
  const require = createRequire(import.meta.url);
  const file = readFileSync(require.resolve("@babylonjs/havok/lib/esm/HavokPhysics.wasm"));
  // A Node `Buffer` is a view into a pooled `ArrayBuffer`, so copy out exactly this file's bytes.
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

/**
 * The version of the installed `@babylonjs/lite`, read off disk.
 *
 * @remarks
 * The package's `exports` map publishes neither `./package.json` nor a `require` condition, so the
 * manifest is found by walking up from the resolved ESM entry point.
 *
 * @returns The version, or `undefined` when the manifest cannot be found.
 */
export function installedLiteVersion(): string | undefined {
  let directory = dirname(fileUrlToPath(import.meta.resolve("@babylonjs/lite")));
  for (let depth = 0; depth < 5; depth += 1) {
    const manifest = readManifest(join(directory, "package.json"));
    if (manifest?.name === "@babylonjs/lite") {
      return manifest.version;
    }
    directory = dirname(directory);
  }
  return undefined;
}

/**
 * Reads and parses one `package.json`, tolerating its absence.
 *
 * @param path - The absolute path.
 * @returns The parsed manifest, or `null`.
 */
function readManifest(path: string): { name?: string; version?: string } | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { name?: string; version?: string };
  } catch {
    return null;
  }
}

/**
 * Turns a `file:` URL into a path `node:fs` accepts.
 *
 * @param url - The URL.
 * @returns The decoded path.
 */
function fileUrlToPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname);
}

/**
 * Reads the bytes and hands them to the Havok factory.
 *
 * @returns The instantiated module.
 */
async function instantiate(): Promise<unknown> {
  const module = await import("@babylonjs/havok");
  return module.default({ wasmBinary: havokWasmBytes() });
}
