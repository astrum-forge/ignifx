import { loadPostEffectSupport } from "../post-effect-support.js";
import { SHADER_ASSET_TYPE, SHADER_FILE_EXTENSIONS, ShaderAsset } from "../shader-asset.js";
import { loadShaderSupport, loadSurfaceShaderSupport } from "../shader-support.js";
import type { AssetLoader, LoaderContext } from "../../assets/types.js";

/**
 * The `shader` asset loader: `.wgsl` to `ShaderAsset`
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1).
 *
 * One loader covers all three forms, because `.surface.wgsl` and `.post.wgsl` both end in `.wgsl`;
 * the `@ignifx shader|surface|post` pragma is what says which form a file is.
 */

/**
 * Builds the loader for `.wgsl` addresses.
 *
 * @remarks
 * A parse failure fails the load, unlike a malformed `.material.json` property: a shader whose
 * declaration cannot be read has no usable fallback (`CONSTITUTION.md` §3.9).
 *
 * The loader is also where the custom-shader layers are pulled into memory. A `ShaderAsset` can only
 * come from here, so awaiting them here is what lets `createMaterialAsset` and the `.material.json`
 * loader build a shader material synchronously (`../shader-support.ts`).
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createShaderLoader());
 * ```
 *
 * @public
 */
export function createShaderLoader(): AssetLoader<ShaderAsset> {
  return {
    type: SHADER_ASSET_TYPE,
    extensions: SHADER_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<ShaderAsset> {
      const [source, pragma] = await Promise.all([ctx.fetchText(), import("../shader-pragma.js")]);
      const declaration = pragma.parseShaderDeclaration(source, ctx.address);
      // The shader-material layer is loaded for every form: a post effect has no material, but its
      // declared-but-unbound samplers are filled from the same 1x1 fallback textures.
      await loadShaderSupport();
      if (declaration.kind === "surface") {
        await loadSurfaceShaderSupport();
      } else if (declaration.kind === "post") {
        await loadPostEffectSupport();
      }
      return new ShaderAsset(ctx.address, source, declaration);
    },
  };
}
