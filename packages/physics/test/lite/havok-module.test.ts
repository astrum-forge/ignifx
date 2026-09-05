import { describe, expect, it } from "vitest";
import { PhysicsErrorCode } from "../../src/errors.js";
import { HAVOK_WASM_FILE_NAME, loadHavok } from "../../src/lite/havok-module.js";
import { loadHavokForTests } from "./fixtures/havok.js";

/**
 * How the Havok module is obtained (`docs/architecture/09-physics.md` §7, ADR-0003 Validation).
 */

describe("loadHavok", () => {
  it("names the file the Vite plugin copies, by base name", () => {
    // Extension public assets are copied unhashed and by base name into the public asset path
    // (`packages/vite-plugin/src/plugin.ts`), and the default asset root is that same directory, so
    // the address is the bare file name.
    expect(HAVOK_WASM_FILE_NAME).toBe("HavokPhysics.wasm");
  });

  it("returns an already-instantiated module untouched", async () => {
    const module = await loadHavokForTests();
    await expect(loadHavok({ module })).resolves.toBe(module);
  }, 30_000);

  it("falls back to the installed package under Node when the URL leads nowhere", async () => {
    // This is what makes `app.isHeadless` change only *where the bytes come from*: a headless Node
    // app resolves `assets/HavokPhysics.wasm`, which no server answers, and the loader reads the
    // binary out of `@babylonjs/havok` itself.
    const module = await loadHavok({ url: "assets/HavokPhysics.wasm" });
    expect(module).toBeDefined();
  }, 60_000);

  it("reports IGX-0903 when the bytes are not a WebAssembly module", async () => {
    let code: string | null = null;
    try {
      await loadHavok({ wasmBinary: new Uint8Array([1, 2, 3, 4]).buffer });
    } catch (error: unknown) {
      code = (error as { code?: string }).code ?? null;
    }
    expect(code).toBe(PhysicsErrorCode.havokUnavailable);
  }, 30_000);
});
