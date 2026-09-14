import { afterEach, describe, expect, it } from "vitest";
import { createStorageBufferAsset, STORAGE_BUFFER_ASSET_TYPE } from "../../src/render/storage-buffer-asset.js";
import { createShaderHarness } from "../fixtures/shaders/harness.js";
import type { ShaderHarness } from "../fixtures/shaders/harness.js";

/**
 * `StorageBufferAsset` on the null engine. The GPU allocation needs a device, so what is asserted
 * here is the half that does not: the rounded capacity, the range rules, and the CPU copy a device
 * loss would re-upload (`docs/architecture/07-rendering.md` §6).
 */

let harness: ShaderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A harness with the storage-buffer asset type registered.
 *
 * @returns The harness.
 */
async function app(): Promise<ShaderHarness> {
  harness = await createShaderHarness();
  return harness;
}

describe("allocation", () => {
  it("publishes a memory address under the storagebuffer type", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(4));
    expect(buffer.type).toBe(STORAGE_BUFFER_ASSET_TYPE);
    expect(buffer.address).toContain(STORAGE_BUFFER_ASSET_TYPE);
    expect(buffer.value.address).toBe(buffer.address);
    expect(buffer.value.name).toBe("spawns");
  });

  it("copies the initial contents", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", Float32Array.from([1, 2, 3, 4]));
    expect(new Float32Array(buffer.value.bytes.buffer, 0, 4)).toEqual(Float32Array.from([1, 2, 3, 4]));
  });

  it("rounds the capacity up to four bytes and never below four", async () => {
    const h = await app();
    using tiny = createStorageBufferAsset(h.app, "tiny", new Uint8Array(1));
    expect(tiny.value.byteLength).toBe(4);
    using odd = createStorageBufferAsset(h.app, "odd", new Uint8Array(5));
    expect(odd.value.byteLength).toBe(8);
  });

  it("holds no Lite buffer under a headless app", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(4));
    expect(buffer.value.lite.buffer).toBeNull();
  });
});

describe("update", () => {
  it("writes into the CPU copy at an offset", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(4));
    buffer.value.update(Float32Array.from([9]), 8);
    expect(new Float32Array(buffer.value.bytes.buffer, 0, 4)).toEqual(Float32Array.from([0, 0, 9, 0]));
  });

  it("accepts a write that fills the buffer exactly", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(2));
    expect(() => {
      buffer.value.update(Float32Array.from([1, 2]), 0);
    }).not.toThrow();
  });

  it("accepts an empty write", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(2));
    expect(() => {
      buffer.value.update(new Uint8Array(0));
    }).not.toThrow();
  });

  it("refuses a write that runs past the end", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(2));
    expect(() => {
      buffer.value.update(Float32Array.from([1, 2]), 4);
    }).toThrow(/IGX-0720/);
  });

  it("refuses an unaligned offset", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(4));
    expect(() => {
      buffer.value.update(Float32Array.from([1]), 2);
    }).toThrow(/IGX-0720/);
  });

  it("refuses a negative offset", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(4));
    expect(() => {
      buffer.value.update(Float32Array.from([1]), -4);
    }).toThrow(/IGX-0720/);
  });

  it("refuses a length that is not a whole number of words", async () => {
    const h = await app();
    using buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(4));
    expect(() => {
      buffer.value.update(new Uint8Array(3));
    }).toThrow(/IGX-0720/);
  });
});

describe("disposal", () => {
  it("is idempotent and reports itself", async () => {
    const h = await app();
    const buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(4));
    expect(buffer.value.isDisposed).toBe(false);
    buffer.value.dispose();
    buffer.value.dispose();
    expect(buffer.value.isDisposed).toBe(true);
    buffer.release();
  });

  it("runs when the last holder releases the handle", async () => {
    const h = await app();
    const buffer = createStorageBufferAsset(h.app, "spawns", new Float32Array(4));
    const asset = buffer.value;
    buffer.release();
    h.app.assets.gc();
    expect(asset.isDisposed).toBe(true);
  });
});
