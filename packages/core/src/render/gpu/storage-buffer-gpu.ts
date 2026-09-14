import {
  createShaderStorageBuffer,
  destroyShaderStorageBuffer,
  updateShaderStorageBuffer,
} from "../../lite/gpu/storage-buffer.js";
import type { LiteStorageBuffer } from "../../lite/gpu/storage-buffer.js";
import type { LiteEngine } from "../../lite/scene.js";

/**
 * The device-only half of `StorageBufferAsset` (`docs/architecture/07-rendering.md` §6).
 *
 * Each entry point takes the engine or the buffer as a nullable and returns early when it is `null`,
 * so the asset keeps no headless branch of its own.
 */

/**
 * Allocates the GPU buffer, or nothing under a headless app.
 *
 * @param isHeadless - Whether the app has a device.
 * @param engine - The engine that owns the allocation.
 * @param bytes - The CPU copy, already rounded to a four-byte multiple.
 * @param name - A debug label.
 * @returns The buffer and the engine to write it through, or two nulls.
 *
 * @internal
 */
export function allocateStorageBuffer(
  isHeadless: boolean,
  engine: LiteEngine,
  bytes: Uint8Array,
  name: string,
): { readonly buffer: LiteStorageBuffer | null; readonly engine: LiteEngine | null } {
  if (isHeadless) {
    return { buffer: null, engine: null };
  }
  return { buffer: createShaderStorageBuffer(engine, bytes, name), engine };
}

/**
 * Writes a range through to the GPU, when there is one.
 *
 * @param engine - The engine, or `null`.
 * @param buffer - The buffer, or `null`.
 * @param data - The bytes to write.
 * @param byteOffset - Where the write starts.
 *
 * @internal
 */
export function writeStorageBuffer(
  engine: LiteEngine | null,
  buffer: LiteStorageBuffer | null,
  data: ArrayBufferView,
  byteOffset: number,
): void {
  if (engine === null || buffer === null) {
    return;
  }
  updateShaderStorageBuffer(engine, buffer, data, byteOffset);
}

/**
 * Frees the GPU allocation, when there is one.
 *
 * @param buffer - The buffer, or `null`.
 *
 * @internal
 */
export function freeStorageBuffer(buffer: LiteStorageBuffer | null): void {
  if (buffer === null) {
    return;
  }
  destroyShaderStorageBuffer(buffer);
}
