import { createStorageBuffer, disposeStorageBuffer, updateStorageBuffer } from "@babylonjs/lite";
import type { EngineContext, StorageBuffer } from "@babylonjs/lite";

/**
 * The read-only storage buffer half of the Babylon Lite adapter
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §2.2). Everything here is `@internal` and needs
 * a device.
 *
 * It is a separate module from `./shader-material.ts`, which a custom WGSL material binds these
 * through, because that one is reached by a dynamic `import()` and `StorageBufferAsset` allocates
 * synchronously; with both halves in one module the build emitted no separate chunk at all
 * (measured 2026-09-08).
 *
 * `createStorageBuffer` rounds the length up to `align(max(byteLength, 4), 4)`, keeps a CPU copy for
 * device-loss recovery, and registers the buffer on the engine so `setShaderStorageBuffer` accepts
 * it (`lib/resource/storage-buffer.js`). Every write must be four-byte aligned and four-byte sized.
 */

/**
 * A Babylon Lite read-only storage buffer, re-exported under an ignifx name
 * (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteStorageBuffer = StorageBuffer;

/**
 * Allocates a read-only storage buffer on the GPU.
 *
 * @param engine - The engine that owns it.
 * @param data - The initial contents, which also fix the capacity.
 * @param label - A GPU debug label.
 * @returns The buffer.
 *
 * @internal
 */
export function createShaderStorageBuffer(engine: EngineContext, data: ArrayBufferView, label: string): StorageBuffer {
  return createStorageBuffer(engine, data, label);
}

/**
 * Overwrites part of a storage buffer.
 *
 * @param engine - The engine that owns the buffer.
 * @param buffer - The buffer to write into.
 * @param data - The bytes to write; the length must be a multiple of four.
 * @param byteOffset - Where to start, in bytes; must be a multiple of four.
 *
 * @internal
 */
export function updateShaderStorageBuffer(
  engine: EngineContext,
  buffer: StorageBuffer,
  data: ArrayBufferView,
  byteOffset: number,
): void {
  updateStorageBuffer(engine, buffer, data, byteOffset);
}

/**
 * Destroys a storage buffer's GPU allocation.
 *
 * @param buffer - The buffer to release. Releasing it twice is a no-op.
 *
 * @internal
 */
export function destroyShaderStorageBuffer(buffer: StorageBuffer): void {
  disposeStorageBuffer(buffer);
}
