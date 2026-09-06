import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * The Havok WebAssembly module the node suites run physics on.
 *
 * It lives under `test/lite/fixtures/` because `@babylonjs/havok` is a native backend and the
 * adapter rule (coding standards §4, dependency-cruiser's `no-native-backend-outside-adapter`)
 * confines it to `src/lite/**` and `test/lite/**`. Every other suite reaches it through the
 * harness. The same file exists in `@ignifx/physics`; duplicating twenty lines is cheaper than a
 * cross-package test import, which the layering rules forbid anyway.
 */

/** The Havok module, instantiated once per process because it costs about a second. */
let cached: Promise<unknown> | null = null;

/**
 * Loads the Havok WebAssembly module under Node from the bytes on disk (ADR-0003, "Validation":
 * `@babylonjs/havok`'s ESM build cannot `fetch` a `file:` URL, and Emscripten's `wasmBinary` is the
 * supported escape).
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
function havokWasmBytes(): ArrayBuffer {
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
