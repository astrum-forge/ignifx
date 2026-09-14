import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { allocateStorageBuffer, freeStorageBuffer, writeStorageBuffer } from "./gpu/storage-buffer-gpu.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { LiteStorageBuffer } from "../lite/gpu/storage-buffer.js";
import type { LiteEngine } from "../lite/scene.js";

/**
 * `StorageBufferAsset` (`docs/plan/2026-09-terrain-particles-shaders.md` §2.2): a read-only GPU
 * buffer a custom WGSL shader indexes, addressed and reference-counted like any other asset.
 *
 * Babylon Lite 1.27.0 binds storage buffers as `var<storage,read>` and exposes no compute dispatch,
 * so this is a one-way channel: the CPU writes records, a shader stage reads them. Lite allocates
 * `align(max(byteLength, 4), 4)` bytes and requires every write to be four-byte aligned and sized
 * (`lib/resource/storage-buffer.js`); the asset reports that rounded capacity and enforces the same
 * rules before calling Lite, so a headless test and a real device agree about what is in range.
 *
 * Headless, `lite.buffer` is `null` and only the CPU copy exists — `update` still validates and
 * {@link StorageBufferAsset.bytes} still shows what was written
 * (`docs/architecture/07-rendering.md` §6).
 */

/**
 * The asset type storage buffers are registered under.
 *
 * @public
 */
export const STORAGE_BUFFER_ASSET_TYPE = "storagebuffer";

/** Storage buffers are allocated and written in whole four-byte words. */
const WORD_BYTES = 4;

/**
 * The Babylon Lite objects a {@link StorageBufferAsset} owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface StorageBufferAssetLiteHandles {
  /** The Lite storage buffer, or `null` under a headless app or after disposal. */
  readonly buffer: LiteStorageBuffer | null;
}

/**
 * A read-only GPU buffer a custom shader indexes
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §2.2).
 *
 * @remarks
 * Bind it to a material with `MaterialAsset.setStorageBuffer(name, handle)`, where `name` is a
 * `// @ignifx storage` declaration in the shader file. The asset keeps a CPU copy of its contents,
 * so a device loss recovers without the game re-uploading anything.
 *
 * @example
 * ```ts
 * const records = new Float32Array(1024);
 * using buffer = createStorageBufferAsset(app, "particles", records);
 * buffer.value.update(records.subarray(0, 64), 0);
 * ```
 *
 * @public
 */
export class StorageBufferAsset {
  /** The type name the asset service registers storage buffers under. */
  static assetType: string = STORAGE_BUFFER_ASSET_TYPE;

  /** A human-readable name, used as the buffer's debug label and in diagnostics. */
  readonly name: string;

  /** The allocated capacity in bytes: the requested length rounded up to four, at least four. */
  readonly byteLength: number;

  readonly #cpu: Uint8Array;

  readonly #engine: LiteEngine | null;

  #address = "";

  #buffer: LiteStorageBuffer | null;

  #isDisposed = false;

  /**
   * Wraps an allocated buffer. Use {@link createStorageBufferAsset}.
   *
   * @param name - A human-readable name.
   * @param byteLength - The rounded capacity.
   * @param cpu - The CPU-side copy, already `byteLength` bytes long.
   * @param buffer - The Lite buffer, or `null` under a headless app.
   * @param engine - The engine that owns the buffer, or `null` under a headless app.
   *
   * @internal
   */
  constructor(
    name: string,
    byteLength: number,
    cpu: Uint8Array,
    buffer: LiteStorageBuffer | null,
    engine: LiteEngine | null,
  ) {
    this.name = name;
    this.byteLength = byteLength;
    this.#cpu = cpu;
    this.#buffer = buffer;
    this.#engine = engine;
  }

  /**
   * The synthetic `memory:` address the asset service published the buffer at.
   *
   * @returns The address, or `""` before {@link createStorageBufferAsset} has published it.
   */
  get address(): string {
    return this.#address;
  }

  /**
   * The CPU-side copy of the buffer's contents.
   *
   * @remarks
   * The asset's own array, not a copy: read it, do not write it. It is what a headless test asserts
   * on and what a device-loss recovery re-uploads.
   *
   * @returns The bytes.
   */
  get bytes(): Uint8Array {
    return this.#cpu;
  }

  /**
   * The Babylon Lite objects the asset owns. Unstable escape hatch.
   *
   * @returns The Lite buffer, or `null` under a headless app or after disposal.
   */
  get lite(): StorageBufferAssetLiteHandles {
    return { buffer: this.#buffer };
  }

  /**
   * Whether the GPU allocation has been given up.
   *
   * @returns `true` once {@link StorageBufferAsset.dispose} has run.
   */
  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /**
   * Records the address the asset service published the buffer at.
   *
   * @param address - The generated `memory:` address.
   *
   * @internal
   */
  publishedAt(address: string): void {
    this.#address = address;
  }

  /**
   * Overwrites part of the buffer.
   *
   * @param data - The bytes to write. The byte length must be a multiple of four.
   * @param byteOffset - Where to start, in bytes; a multiple of four. Defaults to `0`.
   * @throws IgnifxError with code `IGX-0720` when the offset or the length is not a multiple of
   * four, or when the write would run past the end of the buffer.
   *
   * @example
   * ```ts
   * buffer.value.update(new Float32Array([1, 2, 3, 4]), 16);
   * ```
   */
  update(data: ArrayBufferView, byteOffset: number = 0): void {
    this.#assertRange(data.byteLength, byteOffset);
    if (data.byteLength === 0) {
      return;
    }
    this.#cpu.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), byteOffset);
    writeStorageBuffer(this.#engine, this.#buffer, data, byteOffset);
  }

  /**
   * Destroys the GPU allocation. Calling it twice is a no-op, and it is a no-op under a headless
   * app.
   *
   * @remarks
   * The asset service calls this when the last holder releases the handle, so a game that uses
   * `using` or pairs `load`/`release` never has to.
   */
  dispose(): void {
    const buffer = this.#buffer;
    this.#buffer = null;
    this.#isDisposed = true;
    freeStorageBuffer(buffer);
  }

  /**
   * Checks that a write lands inside the buffer, on four-byte boundaries.
   *
   * @param bytes - How many bytes the write covers.
   * @param byteOffset - Where the write starts.
   * @throws IgnifxError with code `IGX-0720`.
   */
  #assertRange(bytes: number, byteOffset: number): void {
    const aligned =
      Number.isInteger(byteOffset) && byteOffset >= 0 && byteOffset % WORD_BYTES === 0 && bytes % WORD_BYTES === 0;
    if (aligned && byteOffset + bytes <= this.byteLength) {
      return;
    }
    throw new IgnifxError(
      CoreErrorCode.storageBufferOutOfRange,
      `${this.name}: an update of ${String(bytes)} bytes at offset ${String(byteOffset)} does not fit the ${String(this.byteLength)}-byte buffer.`,
      {
        context: { buffer: this.name, bytes, offset: byteOffset, capacity: this.byteLength },
        hint: "Storage buffer writes are four-byte aligned and four-byte sized, and must end inside byteLength.",
      },
    );
  }
}

/**
 * Allocates a read-only storage buffer and publishes it as an in-memory asset.
 *
 * @remarks
 * The capacity is fixed at creation: `data.byteLength` rounded up to four bytes. Allocate the whole
 * ring or table once and {@link StorageBufferAsset.update} the part that changed — that is the
 * pattern the stateless particle design is built on, and it is what keeps the per-frame cost to one
 * `writeBuffer`.
 *
 * @param app - The app whose engine allocates it and whose asset service publishes it.
 * @param name - A human-readable name, used as the GPU debug label.
 * @param data - The initial contents, which also fix the capacity.
 * @returns The handle, with one holder — the caller.
 *
 * @example
 * ```ts
 * using table = createStorageBufferAsset(app, "spawns", new Float32Array(4096));
 * material.value.setStorageBuffer("particles", table);
 * ```
 *
 * @public
 */
export function createStorageBufferAsset(
  app: App,
  name: string,
  data: ArrayBufferView,
): AssetHandle<StorageBufferAsset> {
  const byteLength = Math.max(Math.ceil(Math.max(data.byteLength, WORD_BYTES) / WORD_BYTES) * WORD_BYTES, WORD_BYTES);
  const cpu = new Uint8Array(byteLength);
  cpu.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  const gpu = allocateStorageBuffer(app.isHeadless, app.lite.engine, cpu, name);
  const asset = new StorageBufferAsset(name, byteLength, cpu, gpu.buffer, gpu.engine);
  const handle = app.assets.register(asset, { type: STORAGE_BUFFER_ASSET_TYPE });
  asset.publishedAt(handle.address);
  return handle;
}
