import { loadGltfFromBytes } from "../../lite/gpu/gltf.js";
import { createModelAsset, MODEL_ASSET_TYPE, MODEL_FILE_EXTENSIONS } from "../model-asset.js";
import type { AssetLoader, LoaderContext } from "../../assets/types.js";
import type { ModelAsset } from "../model-asset.js";

/**
 * The `model` asset loader (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * ## Bytes, not a URL
 *
 * `loadGltf` accepts a URL, an `ArrayBuffer`, or a `Blob`. ignifx hands it an `ArrayBuffer` fetched
 * through `ctx.fetchBytes`, because that is where progress reporting, `AbortSignal` support, the
 * priority queue, and the retry policy live (§5). A `.glb` is one file, so this is lossless.
 *
 * A `.gltf` with **external** buffers and images is the one case where it is not: Lite would have to
 * resolve those relative URLs itself, which it can only do when it did the fetching. This loader
 * loads the container from bytes either way and therefore supports self-contained `.gltf` files and
 * `.glb`; a `.gltf` with siblings fails inside Lite and surfaces as `IGX-0505`. `.glb` is what the
 * asset pipeline produces, and the fix — passing the URL through for that one shape — is a
 * three-line change whenever a project needs it.
 *
 * ## Headless
 *
 * `loadGltf` throws a `TypeError` under the null engine: it uploads while parsing and reaches for
 * `engine._device` (ADR-0002 Validation). So a headless load skips it entirely and produces an
 * asset with no container — the `gpu: null` shape §5 requires — rather than failing. The bytes are
 * still fetched, so a headless test still exercises the address, the manifest, and the byte
 * counters.
 */

/**
 * Builds the loader for `.glb` and `.gltf` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createModelLoader());
 * ```
 *
 * @public
 */
export function createModelLoader(): AssetLoader<ModelAsset> {
  return {
    type: MODEL_ASSET_TYPE,
    extensions: MODEL_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<ModelAsset> {
      const bytes = await ctx.fetchBytes();
      if (ctx.app.isHeadless) {
        return createModelAsset(ctx.address, null, null);
      }
      const container = await loadGltfFromBytes(ctx.lite.engine, bytes);
      return createModelAsset(ctx.address, container, ctx.app.lite.scene);
    },
    unload(value: ModelAsset): void {
      value.dispose();
    },
  };
}
