import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Everything the suites need off the file system: the Havok WebAssembly bytes and the instantiated
 * module. It loads the real Havok build, not a mock, so every collision a suite sees is one Havok
 * produced and Babylon Lite reported.
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
 * Reads the bytes and hands them to the Havok factory.
 *
 * @returns The instantiated module.
 */
async function instantiate(): Promise<unknown> {
  const module = await import("@babylonjs/havok");
  return module.default({ wasmBinary: havokWasmBytes() });
}
