import { describe, expect, it, vi } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { createCryptoRandom, createSeededRandom } from "../../src/ids/random-source.js";

describe("crypto random source", () => {
  it("fills every byte of the buffer", () => {
    const bytes = new Uint8Array(16);
    createCryptoRandom().fillBytes(bytes);
    expect(bytes.some((byte) => byte !== 0)).toBe(true);
  });

  it("produces a different buffer on each call", () => {
    const random = createCryptoRandom();
    const first = new Uint8Array(16);
    const second = new Uint8Array(16);
    random.fillBytes(first);
    random.fillBytes(second);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it("throws IGX-1401 when the host has no Web Crypto", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      createCryptoRandom();
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.cryptoUnavailable);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", original);
      }
    }
  });

  it("throws IGX-1401 when getRandomValues is missing", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try {
      expect(() => createCryptoRandom()).toThrow(/IGX-1401/u);
    } finally {
      if (original !== undefined) {
        Object.defineProperty(globalThis, "crypto", original);
      }
    }
  });

  it("delegates to getRandomValues", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    try {
      const bytes = new Uint8Array(4);
      createCryptoRandom().fillBytes(bytes);
      expect(spy).toHaveBeenCalledWith(bytes);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("seeded random source", () => {
  it("repeats its stream for the same seed", () => {
    const first = new Uint8Array(32);
    const second = new Uint8Array(32);
    createSeededRandom(7).fillBytes(first);
    createSeededRandom(7).fillBytes(second);
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("produces different streams for neighbouring seeds", () => {
    const first = new Uint8Array(32);
    const second = new Uint8Array(32);
    createSeededRandom(1).fillBytes(first);
    createSeededRandom(2).fillBytes(second);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it("keeps advancing across calls", () => {
    const random = createSeededRandom(3);
    const first = new Uint8Array(16);
    const second = new Uint8Array(16);
    random.fillBytes(first);
    random.fillBytes(second);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it("fills buffers whose length is not a multiple of four", () => {
    const bytes = new Uint8Array(7);
    createSeededRandom(11).fillBytes(bytes);
    expect(bytes.some((byte) => byte !== 0)).toBe(true);
  });

  it("does not get stuck on a zero seed", () => {
    const bytes = new Uint8Array(16);
    createSeededRandom(0).fillBytes(bytes);
    expect(bytes.some((byte) => byte !== 0)).toBe(true);
  });

  it("spreads bytes across the whole range", () => {
    const bytes = new Uint8Array(4096);
    createSeededRandom(42).fillBytes(bytes);
    const seen = new Set(bytes);
    expect(seen.size).toBeGreaterThan(200);
  });
});
