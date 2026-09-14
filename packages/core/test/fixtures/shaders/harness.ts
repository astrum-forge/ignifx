import { createRenderHarness } from "../../render/support/render-harness.js";
import type { AssetHandle } from "../../../src/assets/types.js";
import type { RenderHarness } from "../../render/support/render-harness.js";

/**
 * The shader suites' harness. The `.wgsl` loader, the `PreRender` uniform system and the
 * `storagebuffer` asset type are registered by `src/extension/core-extension.ts` (integrated
 * 2026-09-09), so a plain render harness carries the whole shader layer.
 */

/** A headless render harness with the shader layer registered. */
export interface ShaderHarness extends RenderHarness {
  /** Answers every request for an address, retries included. */
  canned(address: string, body: string): void;
  /** Loads an address, answering it and its dependencies from `files`, and returns the value. */
  load<T>(address: string, files: Readonly<Record<string, string>>): Promise<T>;
}

/**
 * Builds the harness.
 *
 * @returns The harness. Always `dispose()` it.
 */
export async function createShaderHarness(): Promise<ShaderHarness> {
  const base = await createRenderHarness();
  const canned = (address: string, body: string): void => {
    base.net.canned.set(base.app.assets.resolveUrl(address), body);
  };
  return {
    ...base,
    canned,
    load: async <T>(address: string, files: Readonly<Record<string, string>>): Promise<T> => {
      for (const name of Object.keys(files)) {
        canned(name, files[name] ?? "");
      }
      const handle: AssetHandle<T> = base.app.assets.load<T>(address);
      // The harness app is never started, so a completed load is delivered as soon as it finishes
      // (`docs/architecture/05-assets-and-loading.md` §4) and awaiting the handle is enough. It has
      // to be the promise rather than a run of frames: the shader loader awaits a dynamic
      // `import()`, which is real file I/O that no number of microtask flushes advances.
      await handle.promise;
      return handle.value;
    },
  };
}
